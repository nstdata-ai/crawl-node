const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateSource, checkEnvironment, verifyArtifact, checkRegistry, request, hash } = require('../scripts/release.cjs');

const commit = 'a'.repeat(40);
const env = { GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REPOSITORY: 'nstdata-ai/crawl-node', GITHUB_REF: 'refs/heads/main',
    GITHUB_SHA: commit, RELEASE_COMMIT: commit, RELEASE_VERSION: '2.0.0', GH_TOKEN: 'fixture-token' };
const pkg = { name: '@nstdata-ai/crawl', version: '2.0.0', repository: { url: 'git+https://github.com/nstdata-ai/crawl-node.git' } };
const response = (data, status = 200) => ({ status, json: async () => data });
const environment = { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }],
    deployment_branch_policy: { custom_branch_policies: true, protected_branches: false } };
const policies = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] };

test('release identity requires a manually dispatched reviewed main commit and stable matching version', () => {
    validateSource(env, pkg);
    for (const [key, value] of Object.entries({ GITHUB_EVENT_NAME: 'push', GITHUB_REPOSITORY: 'other/crawl-node', GITHUB_REF: 'refs/heads/feature',
        RELEASE_COMMIT: 'b'.repeat(40), RELEASE_VERSION: '2.0.0-rc.1' })) {
        assert.throws(() => validateSource({ ...env, [key]: value }, pkg));
    }
    assert.throws(() => validateSource({ ...env, RELEASE_COMMIT: 'aaaaaaa' }, pkg));
    assert.throws(() => validateSource(env, { ...pkg, version: '2.0.1' }));
    assert.throws(() => validateSource(env, { ...pkg, repository: { url: 'https://github.com/other/repo' } }));
});

test('release environment requires configured reviewers and only the main branch', async () => {
    const calls = [];
    await checkEnvironment(env, async (url, options) => {
        calls.push(url);
        assert.equal(options.headers.Authorization, 'Bearer fixture-token');
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        return response(calls.length === 1 ? environment : policies);
    });
    assert.equal(calls.length, 2);
    assert.ok(calls[1].endsWith('/deployment-branch-policies?per_page=100'));
    for (const invalid of [{}, { ...environment, protection_rules: [] }, { ...environment, protection_rules: [{ type: 'required_reviewers', reviewers: [] }] },
        { ...environment, deployment_branch_policy: { protected_branches: true } }]) {
        await assert.rejects(checkEnvironment(env, async () => response(invalid)));
    }
    for (const invalid of [{ total_count: 2, branch_policies: policies.branch_policies },
        { total_count: 1, branch_policies: [{ name: '*', type: 'branch' }] },
        { total_count: 1, branch_policies: [{ name: 'main', type: 'tag' }] }]) {
        let count = 0;
        await assert.rejects(checkEnvironment(env, async () => response(++count === 1 ? environment : invalid)));
    }
    await assert.rejects(checkEnvironment(env, async () => response({}, 404)));
    await assert.rejects(checkEnvironment({ ...env, GH_TOKEN: '' }, async () => { throw new Error('must not request'); }));
});

test('release artifact binds the checked bytes to the workflow commit, version and manifest digest', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nstdata-release-test-'));
    try {
        const bytes = Buffer.from('fixture archive');
        const manifest = { name: pkg.name, version: pkg.version, commit, filename: 'nstdata-ai-crawl-2.0.0.tgz',
            sha256: hash(bytes), integrity: `sha512-${hash(bytes, 'sha512', 'base64')}` };
        const text = JSON.stringify(manifest);
        fs.writeFileSync(path.join(directory, 'manifest.json'), text);
        fs.writeFileSync(path.join(directory, manifest.filename), bytes);
        const settings = { ...env, RELEASE_MANIFEST_SHA256: hash(text) };
        assert.deepEqual(verifyArtifact(directory, settings).manifest, manifest);
        for (const changed of [{ ...settings, GITHUB_SHA: 'b'.repeat(40) }, { ...settings, RELEASE_VERSION: '2.0.1' },
            { ...settings, RELEASE_MANIFEST_SHA256: '0'.repeat(64) }]) assert.throws(() => verifyArtifact(directory, changed));
        fs.writeFileSync(path.join(directory, manifest.filename), 'modified');
        assert.throws(() => verifyArtifact(directory, settings), /Archive changed/);
        const unsafe = JSON.stringify({ ...manifest, filename: '../unexpected.tgz' });
        fs.writeFileSync(path.join(directory, 'manifest.json'), unsafe);
        assert.throws(() => verifyArtifact(directory, { ...settings, RELEASE_MANIFEST_SHA256: hash(unsafe) }));
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('registry checks distinguish an absent version from errors and require exact published integrity', async () => {
    const published = { name: pkg.name, version: pkg.version, dist: { integrity: 'sha512-fixture' } };
    await checkRegistry(pkg.version, undefined, async (url, options) => {
        assert.equal(url, 'https://registry.npmjs.org/%40nstdata-ai%2Fcrawl/2.0.0');
        assert.deepEqual(options.headers, {});
        return response({}, 404);
    });
    await assert.rejects(checkRegistry(pkg.version, undefined, async () => response(published)), /already exists/);
    await checkRegistry(pkg.version, published.dist.integrity, async () => response(published));
    await assert.rejects(checkRegistry(pkg.version, 'wrong', async () => response(published)), /integrity differs/);
    await assert.rejects(checkRegistry(pkg.version, published.dist.integrity, async () => response({}, 404)), /not visible/);
    for (const status of [401, 403, 429, 500]) {
        let calls = 0;
        await assert.rejects(checkRegistry(pkg.version, undefined, async () => { calls++; return response({}, status); }));
        assert.equal(calls, 1);
    }
    await assert.rejects(request('https://fixture.invalid', undefined, async () => { throw new Error('network unavailable'); }));
    await assert.rejects(request('https://fixture.invalid', undefined, async () => ({ status: 200, json: async () => { throw new Error('invalid JSON'); } })));
});

test('publish CLI uses one checked archive without retries and preserves safe failure diagnostics', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nstdata-release-cli-'));
    try {
        const bytes = Buffer.from('fixture archive');
        const manifest = { name: pkg.name, version: pkg.version, commit, filename: 'nstdata-ai-crawl-2.0.0.tgz',
            sha256: hash(bytes), integrity: `sha512-${hash(bytes, 'sha512', 'base64')}` };
        const text = JSON.stringify(manifest);
        fs.writeFileSync(path.join(directory, 'manifest.json'), text);
        fs.writeFileSync(path.join(directory, manifest.filename), bytes);
        const log = path.join(directory, 'commands.jsonl');
        const bin = path.join(directory, 'bin');
        fs.mkdirSync(bin);
        fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nconsole.log('${commit}');\n`, { mode: 0o755 });
        fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}
            const fs=require('node:fs'),path=require('node:path');
            const args=process.argv.slice(2);
            fs.appendFileSync(process.env.RELEASE_TEST_LOG,JSON.stringify(args)+'\\n');
            if(args[0]==='publish' && process.env.RELEASE_TEST_FAIL==='1') {
                console.error('npm error code E403\\nfixture-secret-must-not-appear');process.exit(1);
            }
            if(args[0]==='install') {
                const folder=path.join(process.cwd(),'node_modules/@nstdata-ai/crawl');fs.mkdirSync(folder,{recursive:true});
                fs.writeFileSync(path.join(folder,'package.json'),JSON.stringify({name:'${pkg.name}',version:'${pkg.version}',main:'index.cjs'}));
                fs.writeFileSync(path.join(folder,'index.cjs'),'exports.NstDataClient=class {};');
            }
        `, { mode: 0o755 });
        const preload = path.join(directory, 'network.cjs');
        fs.writeFileSync(preload, `
            const fs=require('node:fs');
            globalThis.fetch=async url=>{
                let data,status=200;
                if(url.includes('/deployment-branch-policies?')) data=${JSON.stringify(policies)};
                else if(url==='https://api.github.com/repos/nstdata-ai/crawl-node/environments/npm-production') data=${JSON.stringify(environment)};
                else if(url==='https://registry.npmjs.org/%40nstdata-ai%2Fcrawl/2.0.0') {
                    const done=fs.existsSync(process.env.RELEASE_TEST_LOG);
                    status=done?200:404;data=${JSON.stringify({ name: pkg.name, version: pkg.version, dist: { integrity: manifest.integrity } })};
                } else throw new Error('Unexpected network request');
                return {status,json:async()=>data};
            };
        `);
        for (const failure of [false, true]) {
            fs.rmSync(log, { force: true });
            const result = spawnSync(process.execPath, ['--require', preload, path.resolve(__dirname, '../scripts/release.cjs'), 'publish', directory], {
                env: { ...process.env, ...env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, NODE_AUTH_TOKEN: '', NPM_TOKEN: '',
                    RELEASE_MANIFEST_SHA256: hash(text), RELEASE_TEST_LOG: log, RELEASE_TEST_FAIL: failure ? '1' : '0', GITHUB_STEP_SUMMARY: path.join(directory, 'summary.md') },
                encoding: 'utf8', timeout: 15000,
            });
            const commands = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
            assert.deepEqual(commands[0], ['publish', path.join(directory, manifest.filename), '--access', 'public', '--registry',
                'https://registry.npmjs.org', '--ignore-scripts', '--provenance', '--fetch-retries=0']);
            assert.equal(commands.filter(args => args[0] === 'publish').length, 1);
            assert.equal(result.status, failure ? 1 : 0, result.stderr);
            assert.equal(commands.length, failure ? 1 : 2);
            if (failure) {
                assert.match(result.stderr, /npm publish failed \(exit 1, E403\)/);
                assert.ok(!result.stderr.includes('fixture-secret-must-not-appear'));
            }
        }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
