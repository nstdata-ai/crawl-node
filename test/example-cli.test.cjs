const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { inspectDocument } = require('../scripts/documentation.cjs');

test('the documented npm example command runs its actual entry point without external traffic', () => {
    const root = path.resolve(__dirname, '..');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nstdata-example-cli-'));
    try {
        const contribution = fs.readFileSync(path.join(root, 'CONTRIBUTING.md'), 'utf8');
        const commands = inspectDocument(contribution, 'CONTRIBUTING.md').commands
            .filter(args => args[0] === 'npm' && args[1] === 'run' && args[2] === 'example');
        assert.deepEqual(commands, [['npm', 'run', 'example']]);
        for (const file of ['package.json', 'tsconfig.json', 'example.ts']) {
            fs.copyFileSync(path.join(root, file), path.join(directory, file));
        }
        fs.cpSync(path.join(root, 'src'), path.join(directory, 'src'), { recursive: true });
        fs.symlinkSync(path.join(root, 'node_modules'), path.join(directory, 'node_modules'), 'junction');
        const npmCli = [process.env.npm_execpath,
            path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
            path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')]
            .find(file => file && fs.existsSync(file));
        assert.ok(npmCli, 'npm CLI must be available for the documented example');
        const config = path.join(directory, 'npmrc');
        const globalConfig = path.join(directory, 'global-npmrc');
        fs.writeFileSync(config, '');
        fs.writeFileSync(globalConfig, '');
        const fixture = path.join(directory, 'fixture.cjs');
        const log = path.join(directory, 'requests.json');
        fs.writeFileSync(fixture, String.raw`
            const assert = require('node:assert/strict');
            const fs = require('node:fs');
            require('node:net').Socket.prototype.connect = function () {
                throw new Error('Example acceptance forbids network sockets');
            };
            const requests = [];
            if (process.argv.some(arg => arg.endsWith('example.ts'))) {
                process.on('exit', () => fs.writeFileSync(process.env.EXAMPLE_REQUEST_LOG, JSON.stringify(requests)));
            }
            globalThis.fetch = async (input, options) => {
                const url = new URL(input);
                requests.push([options.method ?? 'GET', url.pathname]);
                assert.equal(url.origin, 'https://api.nstdata.io');
                assert.equal(options.headers['x-api-key'], 'example-fixture-token');
                assert.equal(options.redirect, 'manual');
                const variant = process.env.EXAMPLE_CASE;
                if (variant === 'timeout') throw new DOMException('private-fixture-message', 'TimeoutError');
                if (url.pathname === '/api/v1/crawl/storage/read') {
                    assert.equal(url.searchParams.get('st'), 'fixture-markdown');
                    return new Response('# Example fixture');
                }
                assert.equal(options.method, 'POST');
                assert.equal(url.pathname, '/api/v1/crawl/scrape');
                const body = JSON.parse(options.body);
                assert.equal(body.url, 'https://example.com/');
                assert.deepEqual(body.formats, ['markdown']);
                if (variant === 'http') return new Response('private-fixture-message', { status: 403 });
                if (variant === 'invalid-json') return new Response('{');
                return Response.json({ code: 200, err: false, data: {
                    status: variant === 'failed' ? 'failed' : 'completed',
                    success: variant !== 'failed', errorMessage: 'private-fixture-message',
                    data: variant === 'missing' ? {} : variant === 'reference'
                        ? { markdownRef: 'fixture-markdown' } : { markdown: '# Example fixture' },
                } });
            };
        `);
        for (const variant of ['success', 'reference', 'failed', 'missing', 'http', 'invalid-json', 'timeout', 'no-token']) {
            fs.rmSync(log, { force: true });
            const result = spawnSync(process.execPath, [npmCli, ...commands[0].slice(1)], {
                cwd: directory, encoding: 'utf8', timeout: 20000,
                env: { ...process.env, NODE_OPTIONS: `--require ${JSON.stringify(fixture)}`,
                    NODE_AUTH_TOKEN: '', NPM_TOKEN: '', NSTDATA_API_TOKEN: variant === 'no-token' ? '' : 'example-fixture-token',
                    npm_config_userconfig: config, npm_config_globalconfig: globalConfig,
                    npm_config_cache: path.join(directory, 'cache'), npm_config_offline: 'true',
                    npm_config_update_notifier: 'false', EXAMPLE_CASE: variant, EXAMPLE_REQUEST_LOG: log },
            });
            assert.ifError(result.error);
            assert.equal(result.status, ['success', 'reference'].includes(variant) ? 0 : 1,
                `${variant}: ${result.stderr}`);
            assert.doesNotMatch(result.stdout + result.stderr, /private-fixture-message|example-fixture-token/);
            const requests = JSON.parse(fs.readFileSync(log, 'utf8'));
            assert.deepEqual(requests, variant === 'no-token' ? [] : variant === 'reference'
                ? [['POST', '/api/v1/crawl/scrape'], ['GET', '/api/v1/crawl/storage/read']]
                : [['POST', '/api/v1/crawl/scrape']]);
            if (['success', 'reference'].includes(variant)) assert.match(result.stdout, /# Example fixture/);
            if (variant === 'http') assert.match(result.stderr, /403/);
            if (variant === 'timeout') assert.match(result.stderr, /TimeoutError/);
        }
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
