const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nstdata-crawl-package-'));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run check:package');
function npm(args, cwd) {
    return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
}

try {
    // Lifecycle output must not mix with pack's JSON metadata.
    npm(['run', 'build'], root);
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root));
    assert.equal(packed.name, '@nstdata-ai/crawl');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(packed.version, manifest.version);
    assert.equal(lock.version, manifest.version);
    assert.equal(lock.packages[''].version, manifest.version);
    for (const file of ['README.md', 'README_zh.md']) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        assert.ok(text.includes(`npm install ${manifest.name}@${manifest.version}`), `Missing versioned installation command in ${file}`);
    }
    assert.ok(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').includes(`## ${manifest.version} —`), 'Missing version in changelog');
    assert.equal(manifest.engines?.node, '>=22.18.0 <23 || >=24.0.0 <25');
    assert.deepEqual(lock.packages[''].engines, manifest.engines);
    const allowed = /^(dist\/(?:index|client|models)\.(?:js|d\.ts)|package\.json|README(?:_zh)?\.md|LICENSE|CHANGELOG\.md|CONTRIBUTING\.md)$/;
    const secretPatterns = [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, /\bnpm_[a-zA-Z0-9]{30,}\b/, /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/];
    for (const file of packed.files) {
        assert.match(file.path, allowed);
        const text = fs.readFileSync(path.join(root, file.path), 'utf8');
        for (const pattern of secretPatterns) assert.ok(!pattern.test(text), `Secret-like content in ${file.path}`);
    }
    for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/client.js', 'dist/client.d.ts',
        'dist/models.js', 'dist/models.d.ts', 'README.md', 'README_zh.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md']) {
        assert.ok(packed.files.some(entry => entry.path === file), `Missing ${file}`);
    }
    fs.writeFileSync(path.join(temp, 'package.json'), '{"private":true}');
    npm(['install', '--offline', '--cache', path.join(temp, 'npm-cache'), '--ignore-scripts', '--no-audit', '--no-fund', path.join(temp, packed.filename)], temp);
    const installedManifest = JSON.parse(fs.readFileSync(path.join(temp, 'node_modules/@nstdata-ai/crawl/package.json'), 'utf8'));
    assert.deepEqual(installedManifest.engines, manifest.engines);
    fs.mkdirSync(path.join(temp, 'fixtures'));
    fs.copyFileSync(path.join(root, 'test/fixtures/tasks.json'), path.join(temp, 'fixtures/tasks.json'));
    const regressions = fs.readFileSync(path.join(root, 'test/client.test.cjs'), 'utf8')
        .replace("require('../dist')", "require('@nstdata-ai/crawl')");
    fs.writeFileSync(path.join(temp, 'client.test.cjs'), regressions);
    execFileSync(process.execPath, ['--test', 'client.test.cjs'], { cwd: temp, timeout: 10000, stdio: 'pipe' });
    const runtime = `
        const assert = require('node:assert/strict');
        const { NstDataClient, NstDataApiError, ScrapeDataDto, Format, ActionBuilder } = require('@nstdata-ai/crawl');
        assert.equal(typeof NstDataClient, 'function');
        assert.equal(Format.MARKDOWN, 'markdown');
        assert.ok(new NstDataApiError('fixture', { statusCode: 429 }) instanceof Error);
        assert.equal(ActionBuilder.click('a').selector, 'a');
        assert.throws(() => new NstDataClient(''), /token/);
        (async () => {
            const mod = await import('@nstdata-ai/crawl');
            assert.equal(mod.NstDataClient, NstDataClient);
            const client = new NstDataClient('fixture-token', { baseURL: 'https://fixture.invalid', timeoutMs: 1000 });
            const controller = new AbortController();
            controller.abort();
            await assert.rejects(client.getCrawlStatus('id', { signal: controller.signal }), { name: 'AbortError' });
            assert.equal(await new ScrapeDataDto({ markdown: '' }).getMarkdown(), '');
        })().catch(() => { process.exitCode = 1; });
    `;
    fs.writeFileSync(path.join(temp, 'check.cjs'), runtime);
    execFileSync(process.execPath, ['check.cjs'], { cwd: temp, timeout: 10000, stdio: 'pipe' });
    fs.writeFileSync(path.join(temp, 'check.ts'), `
        import { NstDataClient, NstDataApiError, Format, RequestOptions, ClientOptions, ScrapeDataDto, TaskResultResponseDto } from '@nstdata-ai/crawl';
        const options: ClientOptions = { baseURL: 'https://fixture.invalid', timeoutMs: 1000, fetch: globalThis.fetch };
        const request: RequestOptions = { signal: new AbortController().signal, timeoutMs: 1000, maxResponseBytes: 1024 };
        const client = new NstDataClient('fixture-token', options);
        void client.submitScrapeTaskSync({ url: 'https://example.com', formats: [Format.MARKDOWN] }, request);
        // @ts-expect-error Every submission requires explicit formats.
        void client.submitScrapeTask({ url: 'https://example.com' });
        // @ts-expect-error Sync submissions also require explicit formats.
        void client.submitScrapeTaskSync({ url: 'https://example.com' });
        // @ts-expect-error Crawl submissions also require explicit formats.
        void client.submitCrawlTask({ url: 'https://example.com' });
        void client.listCrawlPages('id', { afterCursor: 'cursor', limit: 2 }, request);
        void new ScrapeDataDto({ markdown: '' }).getMarkdown(request);
        const result: TaskResultResponseDto = { id: 'known-task', data: new ScrapeDataDto({ truncated: true }) };
        const id: string | undefined = result.id;
        const truncated: boolean | undefined = result.data?.truncated;
        const pdf: Promise<Buffer | undefined> | undefined = result.data?.getPdf(request);
        const raw: Promise<Buffer | undefined> | undefined = result.data?.getRawData(request);
        const screenshot: Promise<Buffer | undefined> | undefined = result.data?.getScreenshot(request);
        const error: NstDataApiError = new NstDataApiError('fixture', { statusCode: 429, code: 403 });
        void error.statusCode;
    `);
    const typeFiles = ['check.ts'];
    for (const file of ['README.md', 'README_zh.md']) {
        const code = fs.readFileSync(path.join(root, file), 'utf8').match(/```typescript\n([\s\S]*?)```/);
        assert.ok(code, `Missing quick start in ${file}`);
        const sample = `${file}.ts`;
        fs.writeFileSync(path.join(temp, sample), code[1]);
        typeFiles.push(sample);
    }
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--strict',
        '--target', 'ES2022', '--module', 'CommonJS', '--types', 'node', '--typeRoots',
        path.join(root, 'node_modules/@types'), ...typeFiles], { cwd: temp, timeout: 10000, stdio: 'pipe' });
    // Run the installed-package quick starts with an isolated fetch fixture, never the live API.
    fs.writeFileSync(path.join(temp, 'fixture.cjs'), `
        const assert = require('node:assert/strict');
        process.env.NSTDATA_API_TOKEN = 'fixture-token';
        let calls = 0;
        globalThis.fetch = async (url, init) => {
            calls++;
            assert.equal(url, 'https://api.nstdata.io/api/v1/crawl/scrape');
            assert.equal(init.headers['x-api-key'], 'fixture-token');
            const variant = process.env.NSTDATA_QUICKSTART_CASE;
            return Response.json({ code: 200, err: false, data: {
                status: variant === 'pending' ? 'processing' : 'completed',
                success: variant !== 'failed',
                data: variant === 'missing' ? {} : { markdown: '# Fixture' }
            }});
        };
        process.on('beforeExit', () => assert.equal(calls, 1));
    `);
    for (const file of ['README.md.js', 'README_zh.md.js']) {
        const output = execFileSync(process.execPath, ['--require', './fixture.cjs', file], {
            cwd: temp, timeout: 10000, encoding: 'utf8', stdio: 'pipe',
        });
        assert.match(output, /# Fixture/);
        for (const variant of ['pending', 'missing', 'failed']) {
            assert.throws(() => execFileSync(process.execPath, ['--require', './fixture.cjs', file], {
                cwd: temp, timeout: 10000, encoding: 'utf8', stdio: 'pipe',
                env: { ...process.env, NSTDATA_QUICKSTART_CASE: variant },
            }), error => error.status === 1 && !error.stdout.includes('# Fixture'));
        }
    }
    console.log(`PASS: ${packed.name}@${packed.version}; ${packed.files.length} files; allowlist/secret-pattern checks, empty-cache offline install, installed client regressions, CommonJS/ESM imports, installed declarations and EN/ZH quick-start success and pending/missing/failed refusal (synthetic fetch)`);
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
