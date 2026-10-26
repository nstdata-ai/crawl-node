const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { inspectDocument } = require('./documentation.cjs');

const root = path.resolve(__dirname, '..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run with npm run check:package');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nstdata-crawl-package-'));
function npm(args, cwd) {
    return execFileSync(process.execPath, [npmCli, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
}

try {
    // Lifecycle output must not mix with pack's JSON metadata.
    if (!process.argv[2]) npm(['run', 'build'], root);
    const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temp], root));
    assert.equal(packed.name, '@nstdata-ai/crawl');
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    assert.equal(packed.version, manifest.version);
    assert.equal(lock.version, manifest.version);
    assert.equal(lock.packages[''].version, manifest.version);
    for (const file of ['README.md', 'README_zh.md']) {
        const text = fs.readFileSync(path.join(root, file), 'utf8');
        const publicInstall = text.includes(`npm install ${manifest.name}@${manifest.version}`);
        const sourceInstall = text.includes(manifest.version) && /not published|尚未发布/.test(text)
            && text.includes('CONTRIBUTING.md#local-package-installation');
        assert.ok(publicInstall || sourceInstall, `Missing accurate installation instructions in ${file}`);
    }
    assert.ok(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/).includes(`## ${manifest.version}`), 'Missing version in changelog');
    assert.equal(manifest.engines?.node, '>=22.18.0 <23 || >=24.0.0 <25');
    assert.deepEqual(lock.packages[''].engines, manifest.engines);
    const allowed = /^(dist\/(?:index|client|models)\.(?:js|d\.ts)|package\.json|README(?:_zh)?\.md|LICENSE|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md|docs\/guide(?:_zh)?\.md)$/;
    const secretPatterns = [/-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, /\bnpm_[a-zA-Z0-9]{30,}\b/, /\bgh[pousr]_[a-zA-Z0-9]{20,}\b/];
    for (const file of packed.files) {
        assert.match(file.path, allowed);
        const text = fs.readFileSync(path.join(root, file.path), 'utf8');
        for (const pattern of secretPatterns) assert.ok(!pattern.test(text), `Secret-like content in ${file.path}`);
    }
    for (const file of ['dist/index.js', 'dist/index.d.ts', 'dist/client.js', 'dist/client.d.ts',
        'dist/models.js', 'dist/models.d.ts', 'README.md', 'README_zh.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md', 'docs/guide.md', 'docs/guide_zh.md']) {
        assert.ok(packed.files.some(entry => entry.path === file), `Missing ${file}`);
    }
    fs.writeFileSync(path.join(temp, 'package.json'), '{"private":true}');
    const archive = process.argv[2] ?? path.join(temp, packed.filename);
    assert.equal('sha512-' + createHash('sha512').update(fs.readFileSync(archive)).digest('base64'), packed.integrity, 'Archive must match this checkout');
    npm(['install', '--offline', '--cache', path.join(temp, 'npm-cache'), '--ignore-scripts', '--no-audit', '--no-fund', archive], temp);
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
        import { NstDataClient, NstDataApiError, Format, RequestOptions, ClientOptions, ScrapeDataDto, TaskResultResponseDto, CrawlPageItemResponseDto, CrawlPageListResponseDto } from '@nstdata-ai/crawl';
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
        const nullTask: TaskResultResponseDto = { data: null };
        const nullPage: CrawlPageItemResponseDto = { data: null };
        const nullPages: CrawlPageListResponseDto = { data: null };
        void [nullTask, nullPage, nullPages];
    `);
    execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict',
        '--target', 'ES2022', '--module', 'CommonJS', '--types', 'node', '--typeRoots',
        path.join(root, 'node_modules/@types'), 'check.ts'], { cwd: temp, timeout: 10000, stdio: 'pipe' });

    const installedRoot = path.join(temp, 'node_modules/@nstdata-ai/crawl');
    const documents = new Map();
    for (const entry of packed.files.filter(file => file.path.endsWith('.md'))) {
        documents.set(entry.path, inspectDocument(fs.readFileSync(path.join(installedRoot, entry.path), 'utf8'), entry.path));
    }
    for (const [file, document] of documents) {
        for (const target of document.links) {
            if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
            const [relative, anchor] = target.split('#');
            const linked = path.posix.normalize(path.posix.join(path.posix.dirname(file),
                relative ? decodeURIComponent(relative) : path.posix.basename(file)));
            assert.ok(packed.files.some(entry => entry.path === linked), `Unpackaged link: ${file} -> ${target}`);
            if (anchor) {
                assert.ok(documents.get(linked)?.headings.includes(decodeURIComponent(anchor)), `Missing anchor: ${target}`);
            }
        }
    }

    const fixturePath = path.join(temp, 'documentation-fixture.cjs');
    fs.writeFileSync(fixturePath, String.raw`
        const assert = require('node:assert/strict');
        const fs = require('node:fs');
        require('node:net').Socket.prototype.connect = function () {
            throw Object.assign(new Error('Documentation fixtures forbid network sockets'), { code: 'DOCS_NETWORK_BLOCKED' });
        };
        const requests = [];
        const sample = process.env.DOCS_SAMPLE;
        const variant = process.env.DOCS_CASE;
        process.on('exit', () => fs.writeFileSync(process.env.DOCS_LOG, JSON.stringify(requests)));
        const wrap = data => Response.json({ code: 200, err: false, data });
        const content = () => {
            if (variant === 'missing') return {};
            if (sample === 'formats.mts') return variant === 'reference'
                ? { htmlRef: 'fixture-html', pdfRef: 'fixture-pdf' }
                : { html: '<h1>Fixture</h1>', pdf: 'JVBERi0xLjQK' };
            return variant.startsWith('reference') ? { markdownRef: 'fixture-markdown' } : { markdown: '# Fixture' };
        };
        const result = () => ({
            status: ['failed', 'failed-status'].includes(variant) ? 'failed'
                : variant === 'expired-status' ? 'expired' : variant === 'pending' ? 'processing'
                : variant === 'unknown' ? 'future-state' : 'completed',
            success: ['failed-status', 'expired-status'].includes(variant) ? undefined : variant !== 'failed',
            errorMessage: variant === 'failed' ? 'private-fixture-message' : undefined,
            data: content(),
        });
        globalThis.fetch = async (input, init = {}) => {
            const url = new URL(input);
            const method = init.method ?? 'GET';
            requests.push([method, url.pathname + url.search]);
            assert.equal(url.origin, 'https://api.nstdata.io');
            assert.equal(init.headers['x-api-key'], 'fixture-token');
            assert.equal(init.redirect, 'manual');
            assert.ok(init.signal instanceof AbortSignal);
            if (variant === 'http') return new Response('private-fixture-message', { status: 403 });
            if (variant === 'timeout') throw new DOMException('private-fixture-message', 'TimeoutError');
            if (method === 'POST') {
                const body = JSON.parse(init.body);
                assert.equal(body.url, 'https://example.com/');
                if (sample === 'submit-async.mts') {
                    assert.equal(url.pathname + url.search, '/api/v1/crawl/scrape?async=true');
                    return wrap(variant === 'missing' ? {} : { id: 'fixture-task' });
                }
                if (sample === 'start-crawl.mts') {
                    assert.equal(url.pathname, '/api/v1/crawl');
                    assert.equal(body.onlyMainContent, false);
                    return wrap(variant === 'missing' ? {} : { id: 'fixture-crawl' });
                }
                assert.equal(url.pathname + url.search, '/api/v1/crawl/scrape');
                assert.ok(['quickstart.mts', 'render.mts', 'formats.mts'].includes(sample));
                assert.deepEqual(body.formats, sample === 'formats.mts' ? ['html', 'pdf'] : ['markdown']);
                if (sample === 'render.mts') {
                    assert.equal(body.jsRender.waitForSelector, 'h1');
                    assert.deepEqual(body.jsRender.actions.map(action => action.type), ['scrollY', 'wait']);
                }
                return wrap(result());
            }
            assert.equal(method, 'GET');
            if (url.pathname === '/api/v1/crawl/storage/read') {
                const ref = url.searchParams.get('st');
                assert.ok(['fixture-markdown', 'fixture-html', 'fixture-pdf'].includes(ref));
                return new Response(ref === 'fixture-pdf' ? Buffer.from([37, 80, 68, 70, 45, 49, 46, 52, 10])
                    : ref === 'fixture-html' ? '<h1>Fixture</h1>' : '# Fixture');
            }
            if (url.pathname === '/api/v1/crawl/scrape/fixture-task') {
                assert.ok(['read-async.mts', 'controls.mts'].includes(sample));
                return wrap(result());
            }
            if (url.pathname === '/api/v1/crawl/fixture-crawl') {
                assert.equal(sample, 'read-pages.mts');
                return wrap({ status: result().status, total: variant === 'zero' ? 0 : 2,
                    completed: variant === 'zero' ? 0 : 2, failed: 0, pending: 0 });
            }
            assert.equal(url.pathname, '/api/v1/crawl/fixture-crawl/pages');
            assert.equal(sample, 'read-pages.mts');
            assert.equal(url.searchParams.get('limit'), '20');
            const after = url.searchParams.get('after_cursor');
            assert.ok(after === null || after === 'cursor+/=');
            return wrap({ total: variant === 'zero' ? 0 : 2, completed: variant === 'zero' ? 0 : 2,
                data: ['empty', 'zero'].includes(variant) ? [] : [{
                    status: 'completed', success: true, url: 'https://example.com/', data: content(),
                }],
                nextCursor: variant === 'repeated' || after === null && !['empty', 'zero'].includes(variant)
                    ? 'cursor+/=' : undefined });
        };
    `);

    const networkProbe = path.join(temp, 'documentation-network-probe.cjs');
    fs.writeFileSync(networkProbe, String.raw`
        const assert = require('node:assert/strict');
        const nativeFetch = globalThis.fetch;
        require(process.env.DOCS_FIXTURE);
        const blocked = error => error.code === 'DOCS_NETWORK_BLOCKED';
        (async () => {
            for (const protocol of ['http', 'https']) {
                await new Promise((resolve, reject) => {
                    try {
                        require('node:' + protocol).get(protocol + '://127.0.0.1:49152/')
                            .on('error', error => blocked(error) ? resolve() : reject(error));
                    } catch (error) { blocked(error) ? resolve() : reject(error); }
                });
            }
            assert.throws(() => new (require('node:net').Socket)().connect(49152, '127.0.0.1'), blocked);
            await assert.rejects(nativeFetch('http://127.0.0.1:49152/'), error => blocked(error.cause ?? error));
        })().catch(error => { console.error(error); process.exitCode = 1; });
    `);
    const probeEnv = { ...process.env, DOCS_FIXTURE: fixturePath, DOCS_LOG: path.join(temp, 'network-probe.json') };
    delete probeEnv.NODE_OPTIONS;
    execFileSync(process.execPath, [networkProbe], { env: probeEnv, timeout: 10000, stdio: 'pipe' });

    const scenarios = {
        'client.mts': ['success'],
        'quickstart.mts': ['success', 'reference', 'failed', 'pending', 'missing', 'http', 'timeout'],
        'submit-async.mts': ['success', 'missing', 'http'],
        'read-async.mts': ['success', 'reference', 'failed', 'pending', 'missing', 'unknown', 'http', 'timeout'],
        'start-crawl.mts': ['success', 'missing', 'http'],
        'read-pages.mts': ['success', 'reference', 'next', 'reference-next', 'failed', 'pending',
            'missing', 'empty', 'zero', 'repeated', 'http', 'timeout'],
        'render.mts': ['success', 'reference', 'missing', 'http'],
        'formats.mts': ['success', 'reference', 'missing', 'http', 'existing-files'],
        'controls.mts': ['success', 'failed', 'failed-status', 'expired-status', 'http', 'timeout'],
    };
    let programs = 0, runs = 0;
    for (const [file, document] of documents) {
        if (!document.samples.length) continue;
        const directory = path.join(temp, 'examples', file.replace(/[^a-z0-9]/gi, '-'));
        fs.mkdirSync(directory, { recursive: true });
        for (const sample of document.samples) {
            fs.writeFileSync(path.join(directory, sample.filename), sample.code + '\n');
        }
        fs.writeFileSync(path.join(directory, '.env'),
            'NSTDATA_API_TOKEN=fixture-token\nNSTDATA_TASK_ID=fixture-task\nNSTDATA_CRAWL_ID=fixture-crawl\n');
        execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict',
            '--noUnusedLocals', '--allowImportingTsExtensions', '--target', 'ES2022', '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext', '--types', 'node', '--typeRoots', path.join(root, 'node_modules/@types'),
            ...document.samples.map(sample => sample.filename)], { cwd: directory, timeout: 10000, stdio: 'pipe' });
        for (const sample of document.samples) {
            assert.ok(scenarios[sample.filename], `Add executable scenarios for ${sample.filename}`);
            programs++;
            for (const variant of scenarios[sample.filename]) {
                const isNext = ['next', 'reference-next', 'repeated'].includes(variant);
                const log = path.join(directory, 'requests.json');
                for (const output of ['page.html', 'page.pdf']) {
                    fs.rmSync(path.join(directory, output), { force: true });
                    if (variant === 'existing-files') fs.writeFileSync(path.join(directory, output), 'existing');
                }
                const env = { ...process.env, NSTDATA_AFTER_CURSOR: isNext ? 'cursor+/=' : '',
                    DOCS_SAMPLE: sample.filename, DOCS_CASE: variant, DOCS_LOG: log };
                for (const field of ['NSTDATA_API_TOKEN', 'NSTDATA_TASK_ID', 'NSTDATA_CRAWL_ID']) delete env[field];
                const result = spawnSync(process.execPath,
                    ['--require', fixturePath, '--env-file=.env', sample.filename], {
                        cwd: directory, timeout: 10000, encoding: 'utf8', stdio: 'pipe', env,
                    });
                assert.ifError(result.error);
                const { stdout, stderr, status } = result;
                const failure = ['failed', 'pending', 'missing', 'unknown', 'empty', 'repeated', 'http', 'timeout',
                    'existing-files'].includes(variant)
                    && !(variant === 'pending' && ['read-async.mts', 'read-pages.mts'].includes(sample.filename))
                    && !(variant === 'failed' && sample.filename === 'controls.mts');
                assert.equal(status, failure ? 1 : 0, `${file}/${sample.filename}/${variant}: ${stderr}`);
                assert.doesNotMatch(stdout + stderr, /private-fixture-message|fixture-token/);
                const requests = JSON.parse(fs.readFileSync(log, 'utf8'));
                const creates = requests.filter(([method]) => method === 'POST');
                const submits = ['quickstart.mts', 'submit-async.mts', 'start-crawl.mts', 'render.mts', 'formats.mts']
                    .includes(sample.filename);
                assert.equal(creates.length, submits ? 1 : 0, `Unexpected task creation in ${sample.filename}`);
                const expected = [];
                if (submits) expected.push(['POST', sample.filename === 'submit-async.mts'
                    ? '/api/v1/crawl/scrape?async=true' : sample.filename === 'start-crawl.mts'
                        ? '/api/v1/crawl' : '/api/v1/crawl/scrape']);
                else if (sample.filename !== 'client.mts') expected.push(['GET', sample.filename === 'read-pages.mts'
                    ? '/api/v1/crawl/fixture-crawl' : '/api/v1/crawl/scrape/fixture-task']);
                if (sample.filename === 'read-pages.mts' && !['failed', 'pending', 'unknown', 'http', 'timeout'].includes(variant)) {
                    expected.push(['GET', '/api/v1/crawl/fixture-crawl/pages?'
                        + (isNext ? 'after_cursor=cursor%2B%2F%3D&' : '') + 'limit=20']);
                }
                if (variant.startsWith('reference')) {
                    const refs = sample.filename === 'formats.mts'
                        ? ['fixture-html', 'fixture-pdf'] : ['fixture-markdown'];
                    for (const ref of refs) expected.push(['GET', '/api/v1/crawl/storage/read?st=' + ref]);
                }
                assert.deepEqual(requests, expected, `Unexpected request sequence in ${sample.filename}/${variant}`);
                if (sample.filename === 'controls.mts' && ['failed', 'failed-status', 'expired-status'].includes(variant)) {
                    assert.match(stdout, /failed: true/);
                }
                if (variant === 'http') assert.match(stdout + stderr, /403/);
                if (variant === 'timeout') assert.match(stdout + stderr, /TimeoutError/);
                if (['success', 'reference', 'next', 'reference-next'].includes(variant)
                    && ['quickstart.mts', 'read-async.mts', 'read-pages.mts', 'render.mts'].includes(sample.filename)) {
                    assert.match(stdout, /# Fixture/);
                }
                if (sample.filename === 'read-pages.mts' && !failure && variant !== 'pending') {
                    const last = stderr.trim().split('\n').at(-1);
                    assert.deepEqual(JSON.parse(last), {
                        crawlId: 'fixture-crawl', afterCursor: isNext || variant === 'zero' ? null : 'cursor+/=',
                    });
                }
                if (sample.filename === 'formats.mts' && !failure) {
                    assert.equal(fs.readFileSync(path.join(directory, 'page.html'), 'utf8'), '<h1>Fixture</h1>');
                    assert.deepEqual(fs.readFileSync(path.join(directory, 'page.pdf')),
                        Buffer.from([37, 80, 68, 70, 45, 49, 46, 52, 10]));
                }
                if (variant === 'existing-files') {
                    for (const output of ['page.html', 'page.pdf']) {
                        assert.equal(fs.readFileSync(path.join(directory, output), 'utf8'), 'existing');
                    }
                }
                runs++;
            }
        }
    }
    assert.ok(programs > 0, 'No runnable user documentation found');
    console.log(`PASS: ${packed.name}@${packed.version}; ${packed.files.length} files; offline installed-client regressions, CJS/ESM imports and declarations; rendered Markdown links; ${programs} native Node documentation programs / ${runs} synthetic runs`);
} finally {
    fs.rmSync(temp, { recursive: true, force: true });
}
