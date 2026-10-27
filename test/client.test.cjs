const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { NstDataClient, NstDataApiError, ScrapeDataDto } = require('../dist');
const fixtures = require('./fixtures/tasks.json');
const { getEventListeners } = require('node:events');

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const envelope = (data) => Response.json({ code: 200, err: false, data });

test('rejects malformed UTF-8 JSON without replacing content or exposing the response', async () => {
    const body = Buffer.concat([
        Buffer.from('{"code":200,"err":false,"data":{"status":"completed","success":true,"data":{"markdown":"private-'),
        Buffer.from([0xff]), Buffer.from('"}}}'),
    ]);
    const client = new NstDataClient('test-token', { fetch: async () => new Response(body) });
    await assert.rejects(client.getScrapeTaskResult('known'), error => {
        assert.ok(error instanceof NstDataApiError);
        assert.match(error.message, /invalid JSON response/);
        assert.doesNotMatch(error.message, /private-/);
        return true;
    });
    const text = '中文 — valid replacement character: \uFFFD';
    const valid = new NstDataClient('test-token', { fetch: async () => envelope({ data: { markdown: text } }) });
    assert.equal(await (await valid.getScrapeTaskResult('known')).data.getMarkdown(), text);
});

test('rejects overflowing envelope codes instead of exposing nonfinite error metadata', async () => {
    for (const code of ['1e309', '-1e309']) {
        let calls = 0;
        const client = new NstDataClient('test-token', { fetch: async () => {
            calls++;
            return new Response(`{"code":${code},"err":true,"msg":"private-response"}`);
        } });
        await assert.rejects(client.getCrawlStatus('known'), error => {
            assert.ok(error instanceof NstDataApiError);
            assert.match(error.message, /invalid response envelope/);
            assert.equal(error.code, undefined);
            assert.doesNotMatch(error.message, /private-response/);
            return true;
        });
        assert.equal(calls, 1);
    }
});

test('rejects missing tokens before a request', () => {
    for (const token of [undefined, null, '', '   ']) {
        assert.throws(() => new NstDataClient(token), /token/i);
    }
});

test('uses configured baseURL for API and deferred storage reads', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return calls.length === 1
            ? envelope({ status: 'completed', success: true, data: { markdownRef: 'ref /&' } })
            : new Response('# Stored');
    };
    const client = new NstDataClient('test-token', { baseURL: 'https://test.invalid/' });
    const result = await client.submitScrapeTaskSync({ url: 'https://example.com', formats: ['markdown'] });
    assert.equal(await result.data.getMarkdown(), '# Stored');
    assert.equal(calls[0].url, 'https://test.invalid/api/v1/crawl/scrape');
    assert.equal(calls[1].url, 'https://test.invalid/api/v1/crawl/storage/read?st=ref%20%2F%26');
    assert.equal(calls[0].init.headers['x-api-key'], 'test-token');
    assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://example.com', formats: ['markdown'] });
    assert.equal(calls[1].init.headers['Content-Type'], undefined);
});

test('preserves empty inline and stored text without fetching again', async () => {
    let reads = 0;
    const reader = async () => { reads++; return new ArrayBuffer(0); };
    const inline = new ScrapeDataDto({ html: '', markdown: '', htmlRef: 'h', markdownRef: 'm' }, reader);
    assert.equal(await inline.getHtml(), '');
    assert.equal(await inline.getMarkdown(), '');
    assert.equal(reads, 0);
    const stored = new ScrapeDataDto({ htmlRef: 'h', markdownRef: 'm' }, reader);
    for (let i = 0; i < 2; i++) {
        assert.equal(await stored.getHtml(), '');
        assert.equal(await stored.getMarkdown(), '');
    }
    assert.equal(reads, 2);
    const nullable = new ScrapeDataDto({ html: null, htmlRef: 'h' }, reader);
    assert.equal(await nullable.getHtml(), '');
    assert.equal(reads, 3);
});

test('stored HTML and Markdown reject malformed UTF-8 without caching or changing raw bytes', async () => {
    const invalid = Buffer.concat([Buffer.from('private-body-'), Buffer.from([0xff])]);
    const text = '\uFEFF中文 😀 literal replacement: \uFFFD';
    for (const [field, getter] of [['htmlRef', 'getHtml'], ['markdownRef', 'getMarkdown']]) {
        let body = invalid, reads = 0;
        const client = new NstDataClient('fixture-token', { fetch: async url => {
            if (!url.includes('/storage/read?')) return envelope({ data: { [field]: 'private-reference' } });
            reads++;
            return new Response(body);
        } });
        const data = (await client.getScrapeTaskResult('existing-task')).data;
        await assert.rejects(data[getter](), error => {
            assert.ok(error instanceof TypeError);
            assert.match(error.message, /utf-8/i);
            assert.doesNotMatch(error.message, /private-body|private-reference|fixture-token/);
            return true;
        });
        assert.equal(reads, 1, 'a failed decode does not trigger another request');
        assert.deepEqual(Buffer.from(await client.readStorage('private-reference')), invalid);
        body = Buffer.from(text);
        assert.equal(await data[getter](), text);
        assert.equal(await data[getter](), text);
        assert.equal(reads, 3, 'only successful decoded text is cached');
    }
});

test('an already cancelled call makes no request', async () => {
    globalThis.fetch = async () => { assert.fail('must not send'); };
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(new NstDataClient('test-token').getCrawlStatus('id', { signal: controller.signal }), { name: 'AbortError' });
});

test('validates transport configuration', () => {
    for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, 2147483648]) {
        assert.throws(() => new NstDataClient('test-token', { timeoutMs }), /timeoutMs/);
    }
    for (const baseURL of ['not a url', 'file:///tmp/test', 'https://user:pass@test.invalid', 'https://test.invalid?x=1', 'https://test.invalid#x']) {
        assert.throws(() => new NstDataClient('test-token', { baseURL }));
    }
});

test('encodes IDs and separates transport options from documented request DTOs', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push([url, init]); return envelope({}); };
    const client = new NstDataClient('test-token');
    const req = { url: 'https://example.com', formats: ['markdown'], timeout: 60000 };
    const options = { timeoutMs: 1000, signal: new AbortController().signal };
    await client.submitScrapeTask(req, options);
    await client.submitScrapeTaskSync(req, options);
    await client.getScrapeTaskResult('id /?', options);
    await client.submitCrawlTask({ ...req, maxPages: 2 }, options);
    await client.getCrawlStatus('id /?', options);
    await client.listCrawlPages('id /?', { afterCursor: 'next /&', limit: 2 }, options);
    assert.deepEqual(calls.map(([url]) => url.replace('https://api.nstdata.io', '')), [
        '/api/v1/crawl/scrape?async=true', '/api/v1/crawl/scrape', '/api/v1/crawl/scrape/id%20%2F%3F',
        '/api/v1/crawl', '/api/v1/crawl/id%20%2F%3F',
        '/api/v1/crawl/id%20%2F%3F/pages?after_cursor=next+%2F%26&limit=2',
    ]);
    assert.deepEqual(calls.map(([, init]) => init.method), ['POST', 'POST', 'GET', 'POST', 'GET', 'GET']);
    assert.deepEqual(JSON.parse(calls[0][1].body), req);
    assert.equal(calls[2][1].body, undefined);
    assert.equal(calls[2][1].headers['Content-Type'], undefined);
    assert.equal(getEventListeners(options.signal, 'abort').length, 0);
});

test('preserves processing, failed and successful task results', async () => {
    const client = new NstDataClient('test-token');
    for (const name of ['processing', 'failed', 'completed']) {
        globalThis.fetch = async () => Response.json(fixtures[name]);
        const result = await client.getScrapeTaskResult('id');
        assert.equal(result.status, fixtures[name].data.status);
        if (name === 'failed') {
            assert.equal(result.success, false);
            assert.equal(result.errorCode, 'FIXTURE_FAILURE');
            assert.equal(result.data, undefined);
        } else if (name === 'completed') {
            assert.ok(result.data instanceof ScrapeDataDto);
            assert.equal(await result.data.getMarkdown(), '# Fixture');
            assert.equal(await result.data.getHtml(), '');
            assert.equal(result.data.metadata.title, 'Fixture');
        }
    }
});

test('page cursors and deferred references survive normalization, including an empty last page', async () => {
    const calls = [];
    globalThis.fetch = async (url) => {
        calls.push(url);
        if (url.includes('storage/read')) return new Response('# Page');
        return Response.json(url.includes('after_cursor') ? fixtures.lastPage : fixtures.pages);
    };
    const client = new NstDataClient('test-token');
    const first = await client.listCrawlPages('id');
    assert.equal(first.data[1].data, undefined);
    assert.equal(await first.data[0].data.getMarkdown(), '# Page');
    const last = await client.listCrawlPages('id', { afterCursor: first.nextCursor, limit: 2 });
    assert.deepEqual(last.data, []);
    assert.equal(last.nextCursor, undefined);
    assert.equal(calls.length, 3);
    assert.match(calls[2], /after_cursor=next\+%2F%26&limit=2$/);
});

test('rejects invalid API payload containers without exposing their contents', async () => {
    for (const data of [undefined, null, false, 42, 'private-response', [], [{ private: 'response' }]]) {
        let calls = 0;
        const client = new NstDataClient('test-token', { fetch: async () => {
            calls++;
            return envelope(data);
        } });
        await assert.rejects(client.submitCrawlTask({ url: 'https://example.com', formats: ['markdown'] }), error => {
            assert.ok(error instanceof NstDataApiError);
            assert.equal(error.statusCode, 200);
            assert.match(error.message, /invalid response payload/);
            assert.doesNotMatch(error.message, /private-response/);
            return true;
        });
        assert.equal(calls, 1);
    }
});

test('rejects malformed page collections before returning partial results', async () => {
    for (const data of ['private-response', {}, [null], [false], [42], ['private-response'], [[]], [{ data: 'private-response' }]]) {
        const client = new NstDataClient('test-token', {
            fetch: async () => envelope({ total: 1, data }),
        });
        await assert.rejects(client.listCrawlPages('crawl'), error => {
            assert.ok(error instanceof NstDataApiError);
            assert.match(error.message, /invalid page results/);
            assert.doesNotMatch(error.message, /private-response/);
            return true;
        });
    }
});

test('rejects malformed single-page content without hiding task failures', async () => {
    for (const data of [false, 42, 'private-response', []]) {
        const client = new NstDataClient('test-token', {
            fetch: async () => envelope({ success: true, status: 'completed', data }),
        });
        await assert.rejects(client.submitScrapeTaskSync({ url: 'https://example.com', formats: ['markdown'] }), NstDataApiError);
        await assert.rejects(client.getScrapeTaskResult('task'), NstDataApiError);
    }
    const client = new NstDataClient('test-token', {
        fetch: async () => envelope({ success: false, status: 'failed', data: null, errorCode: 'TASK_FAILED' }),
    });
    const result = await client.getScrapeTaskResult('task');
    assert.equal(result.success, false);
    assert.equal(result.errorCode, 'TASK_FAILED');
    assert.equal(result.data, null);
});

test('accepts empty page results and additional response fields', async () => {
    for (const data of [undefined, null, []]) {
        const client = new NstDataClient('test-token', { fetch: async () => envelope({ data, futureField: true }) });
        const result = await client.listCrawlPages('crawl');
        assert.deepEqual(result.data, data);
        assert.equal(result.futureField, true);
    }
    const client = new NstDataClient('test-token', { fetch: async () => envelope({
        data: [{ success: false, data: null, errorCode: 'TASK_FAILED' }, { data: { markdown: '', futureField: true } }],
        nextCursor: 'next',
    }) });
    const result = await client.listCrawlPages('crawl');
    assert.equal(result.data[0].errorCode, 'TASK_FAILED');
    assert.equal(result.data[0].data, null);
    assert.equal(await result.data[1].data.getMarkdown(), '');
    assert.equal(result.nextCursor, 'next');
});

test('binary references use the reader and cache zero-length downloads', async () => {
    for (const [ref, getter] of [['pdfRef', 'getPdf'], ['rawDataRef', 'getRawData'], ['screenshotRef', 'getScreenshot']]) {
        let reads = 0;
        const data = new ScrapeDataDto({ [ref]: 'fixture-ref' }, async () => { reads++; return new ArrayBuffer(0); });
        assert.deepEqual(await data[getter](), Buffer.alloc(0));
        assert.deepEqual(await data[getter](), Buffer.alloc(0));
        assert.equal(reads, 1);
    }
});

test('inline binary and raw content survive sync, result and crawl page responses', async () => {
    for (const operation of ['sync', 'result', 'pages']) {
        let requests = 0;
        const client = new NstDataClient('test-token', { fetch: async () => {
            assert.equal(++requests, 1, 'inline getters must not download references');
            const data = {
                pdf: 'JVBERi0xLjQK', screenshot: 'AP+A', rawData: '<p>雪</p>',
                ...(operation === 'result' ? {
                    pdfRef: 'pdf-ref', screenshotRef: 'image-ref', rawDataRef: 'raw-ref',
                } : {}),
            };
            return envelope(operation === 'pages' ? { data: [{ data }] } : { success: true, data });
        } });
        const result = operation === 'sync'
            ? await client.submitScrapeTaskSync({ url: 'https://example.com', formats: ['pdf', 'screenshot', 'rawData'] })
            : operation === 'result' ? await client.getScrapeTaskResult('task') : await client.listCrawlPages('crawl');
        const data = operation === 'pages' ? result.data[0].data : result.data;
        for (let i = 0; i < 2; i++) {
            assert.deepEqual(await data.getPdf(), Buffer.from([37, 80, 68, 70, 45, 49, 46, 52, 10]));
            assert.deepEqual(await data.getScreenshot(), Buffer.from([0, 255, 128]));
            assert.deepEqual(await data.getRawData(), Buffer.from([60, 112, 62, 233, 155, 170, 60, 47, 112, 62]));
        }
        assert.equal(requests, 1);
    }
});

test('preserves task identity and explicit truncation on sync, result and crawl pages', async () => {
    for (const truncated of [true, false, undefined, null]) {
        const payload = { id: 'known-task', success: true, data: { markdown: '# Fixture', truncated } };
        const client = new NstDataClient('test-token', { fetch: async url => envelope(
            url.endsWith('/pages') ? { data: [{ ...payload, taskId: 'known-page' }] } : payload,
        ) });
        const sync = await client.submitScrapeTaskSync({ url: 'https://example.com', formats: ['markdown'] });
        const result = await client.getScrapeTaskResult('known-task');
        const pages = await client.listCrawlPages('crawl');
        assert.equal(sync.id, 'known-task');
        assert.equal(result.id, 'known-task');
        assert.equal(pages.data[0].taskId, 'known-page');
        for (const data of [sync.data, result.data, pages.data[0].data]) {
            assert.equal(data.truncated, truncated === null ? undefined : truncated);
            assert.equal(await data.getMarkdown(), '# Fixture');
        }
    }
});

test('distinguishes empty inline bytes from absent content and reference fallback', async () => {
    for (const [field, getter] of [['pdf', 'getPdf'], ['screenshot', 'getScreenshot'], ['rawData', 'getRawData']]) {
        for (const value of ['', null, undefined]) {
            let downloads = 0;
            const client = new NstDataClient('test-token', { fetch: async url => {
                if (url.includes('/storage/read?')) {
                    downloads++;
                    return new Response(new Uint8Array([0, 255, 128]));
                }
                return envelope({ data: { [field]: value, [field + 'Ref']: 'stored-ref' } });
            } });
            const result = await client.getScrapeTaskResult('task');
            const expected = value === '' ? Buffer.alloc(0) : Buffer.from([0, 255, 128]);
            assert.deepEqual(await result.data[getter](), expected);
            assert.deepEqual(await result.data[getter](), expected);
            assert.equal(downloads, value === '' ? 0 : 1);
            const missing = new NstDataClient('test-token', { fetch: async () => envelope({ data: { [field]: value } }) });
            const absent = await missing.getScrapeTaskResult('task');
            assert.deepEqual(await absent.data[getter](), value === '' ? Buffer.alloc(0) : undefined);
        }
    }
});

test('decodes padded, unpadded and large inline Base64 without treating raw text as Base64', async () => {
    for (const [screenshot, expected] of [
        ['AQ==', Buffer.from([1])], ['AQ', Buffer.from([1])],
        ['AQI=', Buffer.from([1, 2])], ['AQI', Buffer.from([1, 2])],
        ['AP+A'.repeat(65536), Buffer.alloc(196608, Buffer.from([0, 255, 128]))],
    ]) {
        const client = new NstDataClient('test-token', { fetch: async () => envelope({ data: { screenshot, rawData: 'AQID' } }) });
        const result = await client.getScrapeTaskResult('task');
        assert.deepEqual(await result.data.getScreenshot(), expected);
        assert.deepEqual(await result.data.getRawData(), Buffer.from([65, 81, 73, 68]));
    }
});

test('rejects malformed inline content and truncation without exposing it or retrying', async () => {
    const invalid = [
        ...['pdf', 'screenshot'].flatMap(field => [
            42, false, {}, [], 'private-response!', 'A', 'AQ=I', 'AQ===', 'AQ=', 'AAAA==',
        ].map(value => ({ [field]: value }))),
        ...[42, false, {}, []].map(rawData => ({ rawData })),
        ...['true', 1, {}, []].map(truncated => ({ truncated })),
    ];
    for (const data of invalid) {
        for (const operation of ['sync', 'result', 'pages']) {
            let requests = 0;
            const client = new NstDataClient('test-token', { fetch: async () => {
                requests++;
                return envelope(operation === 'pages' ? { data: [{ data }] } : { success: true, data });
            } });
            const pending = operation === 'sync'
                ? client.submitScrapeTaskSync({ url: 'https://example.com', formats: ['pdf'] })
                : operation === 'result' ? client.getScrapeTaskResult('task') : client.listCrawlPages('crawl');
            await assert.rejects(pending, error => {
                assert.ok(error instanceof NstDataApiError);
                assert.match(error.message, /invalid task content/);
                assert.doesNotMatch(error.message, /private-response/);
                return true;
            });
            assert.equal(requests, 1);
        }
    }
});

test('HTTP, envelope and JSON failures propagate without retrying a task creation', async () => {
    for (const [response, pattern] of [
        [() => new Response('unavailable', { status: 503 }), /status=503/],
        [() => Response.json({ code: 403, err: true, msg: 'denied' }), /code=403/],
        [() => Response.json({ wrong: true }), /invalid response envelope/],
        [() => new Response('invalid JSON'), /JSON/],
    ]) {
        let calls = 0;
        globalThis.fetch = async () => { calls++; return response(); };
        await assert.rejects(new NstDataClient('test-token').submitScrapeTask({ url: 'https://example.com', formats: ['markdown'] }), pattern);
        assert.equal(calls, 1);
    }
});

test('API body transport failures retain their identity with and without a byte cap', async () => {
    for (const maxResponseBytes of [undefined, 1024]) {
        for (const operation of ['submit', 'status']) {
            const failure = new TypeError('synthetic body connection interrupted');
            let calls = 0, chunks = 0;
            globalThis.fetch = async () => {
                calls++;
                return new Response(new ReadableStream({
                    pull(controller) {
                        if (chunks++ === 0) controller.enqueue(new TextEncoder().encode('{"code":'));
                        else controller.error(failure);
                    },
                }));
            };
            const signal = new AbortController().signal;
            const options = { maxResponseBytes, signal };
            const client = new NstDataClient('test-token');
            const request = operation === 'submit'
                ? client.submitScrapeTask({ url: 'https://example.com', formats: ['markdown'] }, options)
                : client.getCrawlStatus('existing', options);
            await assert.rejects(request, error => error === failure);
            assert.equal(calls, 1);
            assert.equal(getEventListeners(signal, 'abort').length, 0);
        }
    }
});

test('storage HTTP errors are distinct from task failures', async () => {
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(new NstDataClient('test-token').readStorage('missing'), /readStorage error: status=404/);
});

test('deferred reads inherit the originating cancellation signal', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return envelope({ data: { markdownRef: 'ref' } }); };
    const controller = new AbortController();
    const result = await new NstDataClient('test-token').getScrapeTaskResult('id', { signal: controller.signal });
    controller.abort();
    await assert.rejects(result.data.getMarkdown(), { name: 'AbortError' });
    assert.equal(calls, 1);
});

test('rejects malformed text, reference, link and metadata fields across every task result path', async () => {
    const secret = 'private-response-value';
    const malformed = [
        ...['html', 'markdown', 'htmlRef', 'markdownRef', 'pdfRef', 'rawDataRef', 'screenshotRef'].map(field => ({ [field]: { secret } })),
        { links: secret }, { links: [secret, 1] }, { metadata: secret }, { metadata: [] },
        ...['canonical', 'description', 'language', 'ogImage', 'title'].map(field => ({ metadata: { [field]: { secret } } })),
        { metadata: { statusCode: secret } },
    ];
    for (const data of malformed) for (const operation of ['sync', 'query', 'pages']) {
        let calls = 0;
        globalThis.fetch = async () => { calls++; return envelope(operation === 'pages' ? { data: [{ data }] } : { status: 'completed', success: true, data }); };
        const client = new NstDataClient('test-token');
        const action = operation === 'sync' ? client.submitScrapeTaskSync({ url: 'https://example.com/', formats: ['markdown'] })
            : operation === 'query' ? client.getScrapeTaskResult('known-id') : client.listCrawlPages('known-id');
        await assert.rejects(action, error => error instanceof NstDataApiError && !error.message.includes(secret));
        assert.equal(calls, 1);
    }
});

test('normalizes null content fields and preserves empty links, metadata and unfamiliar metadata fields', async () => {
    globalThis.fetch = async () => envelope({ status: 'completed', success: true, data: {
        html: null, markdown: null, links: null, metadata: null, htmlRef: null, markdownRef: null,
        pdfRef: null, rawDataRef: null, screenshotRef: null,
    } });
    const client = new NstDataClient('test-token'), absent = (await client.getScrapeTaskResult('known-id')).data;
    for (const field of ['links', 'metadata', 'htmlRef', 'markdownRef', 'pdfRef', 'rawDataRef', 'screenshotRef']) assert.equal(absent[field], undefined);
    assert.equal(await absent.getMarkdown(), undefined);
    globalThis.fetch = async () => envelope({ data: { markdown: '', links: [], metadata: { title: '', statusCode: 200, extra: { preserved: true } } } });
    const empty = (await client.getScrapeTaskResult('known-id')).data;
    assert.equal(await empty.getMarkdown(), ''); assert.deepEqual(empty.links, []);
    assert.deepEqual(empty.metadata, { title: '', statusCode: 200, extra: { preserved: true } });
});

test('normalizes header whitespace before sending and redacting the API token', async () => {
    const token = 'synthetic-header-token';
    let sent;
    const client = new NstDataClient(` \t${token}\t `, {
        fetch: async (_url, init) => {
            sent = new Headers(init.headers).get('x-api-key');
            return Response.json({ code: 403, err: true, msg: `denied ${sent}` });
        },
    });
    await assert.rejects(client.getCrawlStatus('known'), error => {
        assert.ok(error instanceof NstDataApiError);
        assert.doesNotMatch(error.message, new RegExp(token));
        assert.match(error.message, /<REDACTED>/);
        return true;
    });
    assert.equal(sent, token);
});

test('rejects invalid token header values without including the credential in errors', () => {
    for (const token of ['synthetic\nprivate-token', 'synthetic\0private-token', 'synthetic-雪-token']) {
        assert.throws(() => new NstDataClient(token), error => {
            assert.match(error.message, /token/i);
            assert.doesNotMatch(error.message, /synthetic|private|雪/);
            return true;
        });
    }
});

test('validates known submission and task fields while preserving optional and future fields', async () => {
    const submissions = [
        client => client.submitScrapeTask({ url: 'https://example.com', formats: ['markdown'] }),
        client => client.submitCrawlTask({ url: 'https://example.com', formats: ['markdown'] }),
    ];
    for (const run of submissions) {
        for (const data of [{ id: 42 }, { status: true }, { cached: 'false' }, { code: '0' }]) {
            const client = new NstDataClient('fixture-token', { fetch: async () => envelope(data) });
            await assert.rejects(run(client), NstDataApiError);
        }
        const valid = new NstDataClient('fixture-token', {
            fetch: async () => envelope({ id: null, status: 'future-state', cached: false, code: 0, future: { keep: true } }),
        });
        assert.deepEqual(await run(valid), {
            id: undefined, status: 'future-state', cached: false, code: 0, future: { keep: true },
        });
    }
    const operations = [
        client => client.submitScrapeTaskSync({ url: 'https://example.com', formats: ['markdown'] }),
        client => client.getScrapeTaskResult('known'),
        async client => (await client.listCrawlPages('known')).data[0],
    ];
    for (const run of operations) {
        for (const item of [
            { success: 'false' }, { status: 42 }, { errorCode: {} }, { errorMessage: false },
        ]) {
            const client = new NstDataClient('fixture-token', {
                fetch: async url => envelope(url.includes('/pages') ? { data: [item] } : item),
            });
            await assert.rejects(run(client), NstDataApiError);
        }
        const item = { success: false, status: 'future-state', errorCode: 'known', errorMessage: null, future: 'preserved' };
        const client = new NstDataClient('fixture-token', {
            fetch: async url => envelope(url.includes('/pages') ? { data: [item] } : item),
        });
        assert.deepEqual(await run(client), { ...item, errorMessage: undefined });
    }
    for (const run of operations.slice(0, 2)) {
        for (const item of [{ id: [] }, { code: false }]) {
            const client = new NstDataClient('fixture-token', { fetch: async () => envelope(item) });
            await assert.rejects(run(client), NstDataApiError);
        }
    }
    for (const item of [{ taskId: 42 }, { url: {} }]) {
        const client = new NstDataClient('fixture-token', { fetch: async () => envelope({ data: [item] }) });
        await assert.rejects(client.listCrawlPages('known'), NstDataApiError);
    }
    const extendedPage = {
        taskId: 'known-page', id: 42, code: 'future-page-code', data: { markdown: '' },
    };
    const extendedClient = new NstDataClient('fixture-token', {
        fetch: async () => envelope({ data: [extendedPage] }),
    });
    const page = (await extendedClient.listCrawlPages('known')).data[0];
    assert.equal(page.id, 42);
    assert.equal(page.code, 'future-page-code');
    assert.equal(await page.data.getMarkdown(), '');
});

test('rejects malformed crawl counts and cursors without rejecting empty or extended results', async () => {
    for (const value of [-1, 1.5, '2', true, {}, 9007199254740992]) {
        for (const field of ['total', 'completed', 'failed', 'pending']) {
            const client = new NstDataClient('fixture-token', { fetch: async () => envelope({ [field]: value }) });
            await assert.rejects(client.getCrawlStatus('known'), NstDataApiError);
        }
        for (const field of ['total', 'completed']) {
            const client = new NstDataClient('fixture-token', { fetch: async () => envelope({ [field]: value, data: [] }) });
            await assert.rejects(client.listCrawlPages('known'), NstDataApiError);
        }
    }
    for (const field of ['nextCursor', 'prevCursor']) {
        const client = new NstDataClient('fixture-token', { fetch: async () => envelope({ [field]: {}, data: [] }) });
        await assert.rejects(client.listCrawlPages('known'), NstDataApiError);
    }
    const overflow = new NstDataClient('fixture-token', {
        fetch: async () => new Response('{"code":200,"err":false,"data":{"total":1e309}}'),
    });
    await assert.rejects(overflow.getCrawlStatus('known'), NstDataApiError);
    const valid = new NstDataClient('fixture-token', {
        fetch: async () => envelope({ total: 0, completed: 0, failed: null, nextCursor: null, data: [], extra: true }),
    });
    const status = await valid.getCrawlStatus('known');
    assert.equal(status.failed, undefined);
    assert.equal(status.extra, true);
    const page = await valid.listCrawlPages('known');
    assert.deepEqual(page.data, []);
    assert.equal(page.nextCursor, undefined);
});

test('normalizes nullable known metadata fields without removing unknown metadata', async () => {
    const metadata = { title: null, canonical: null, description: null, language: null, ogImage: null,
        statusCode: null, custom: { value: null } };
    const client = new NstDataClient('fixture-token', { fetch: async () => envelope({ data: { metadata } }) });
    const normalized = (await client.getScrapeTaskResult('known')).data.metadata;
    for (const field of ['title', 'canonical', 'description', 'language', 'ogImage', 'statusCode']) {
        assert.equal(normalized[field], undefined);
    }
    assert.deepEqual(normalized.custom, { value: null });
});

test('rejects base URLs with empty query or fragment delimiters', async () => {
    for (const baseURL of ['https://fixture.invalid/?', 'https://fixture.invalid/#', 'https://fixture.invalid/path?#']) {
        assert.throws(() => new NstDataClient('fixture-token', { baseURL }), /baseURL/);
    }
    const calls = [];
    const client = new NstDataClient('fixture-token', {
        baseURL: 'https://fixture.invalid/prefix/',
        fetch: async url => { calls.push(url); return envelope({}); },
    });
    await client.getCrawlStatus('known');
    assert.equal(calls[0], 'https://fixture.invalid/prefix/api/v1/crawl/known');
});

test('invalid base URL errors never retain credential-bearing input', () => {
    for (const baseURL of ['https://synthetic-user:synthetic-secret@[', 'http://\u0000invalid']) {
        assert.throws(() => new NstDataClient('fixture-token', { baseURL }), error => {
            assert.match(error.message, /baseURL/);
            assert.equal(Object.hasOwn(error, 'input'), false);
            assert.doesNotMatch(JSON.stringify(error), /synthetic|secret|invalid/);
            return true;
        });
    }
});

test('rejects empty or dot-segment task IDs before dispatch while retaining opaque IDs', async () => {
    let calls = 0;
    const client = new NstDataClient('fixture-token', {
        fetch: async () => { calls++; return envelope({}); },
    });
    for (const id of ['', ' ', '.', '..', null, undefined, 42]) {
        await assert.rejects(client.getScrapeTaskResult(id), /ID/);
        await assert.rejects(client.getCrawlStatus(id), /ID/);
        await assert.rejects(client.listCrawlPages(id), /ID/);
    }
    assert.equal(calls, 0);
    await client.getScrapeTaskResult('opaque /?&');
    assert.equal(calls, 1);
});

test('rejects invalid page sizes, cursor types and conflicting directions before dispatch', async () => {
    let calls = 0;
    const client = new NstDataClient('fixture-token', {
        fetch: async () => { calls++; return envelope({ data: [] }); },
    });
    for (const limit of [0, -1, NaN, Infinity, 1.5, '1', 9007199254740992]) {
        await assert.rejects(client.listCrawlPages('known', { limit }), /limit/);
    }
    for (const opts of [{ afterCursor: {} }, { beforeCursor: 1 }, { afterCursor: 'a', beforeCursor: 'b' }]) {
        await assert.rejects(client.listCrawlPages('known', opts), /cursor/i);
    }
    assert.equal(calls, 0);
    await client.listCrawlPages('known', { afterCursor: '', limit: 1 });
    await client.listCrawlPages('known', { beforeCursor: 'opaque /?&', limit: 1 });
    assert.equal(calls, 2);
});

test('snapshots request controls for body reads, cleanup and deferred getters', async () => {
    const controller = new AbortController();
    const other = new AbortController();
    const options = { signal: controller.signal, timeoutMs: 1000, maxResponseBytes: 1024 };
    let calls = 0;
    const client = new NstDataClient('fixture-token', {
        fetch: async url => {
            calls++;
            if (url.includes('/storage/read')) return new Response('# Stored');
            options.signal = other.signal;
            options.maxResponseBytes = 1;
            return envelope({ data: { markdownRef: 'opaque' } });
        },
    });
    const result = await client.getScrapeTaskResult('known', options);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    options.timeoutMs = 0;
    assert.equal(await result.data.getMarkdown(), '# Stored');
    assert.equal(calls, 2);
    const next = await client.getScrapeTaskResult('known', { signal: controller.signal });
    controller.abort();
    await assert.rejects(next.data.getMarkdown(), { name: 'AbortError' });
    assert.equal(calls, 3);
});

test('snapshots declared controls from prototype getters on every request entry point', async () => {
    class ByteLimit {
        get maxResponseBytes() { return 1; }
    }
    const client = new NstDataClient('fixture-token', { fetch: async () => envelope({}) });
    const request = { url: 'https://example.com', formats: ['markdown'] };
    for (const run of [
        () => client.submitScrapeTask(request, new ByteLimit()),
        () => client.submitScrapeTaskSync(request, new ByteLimit()),
        () => client.getScrapeTaskResult('known', new ByteLimit()),
        () => client.submitCrawlTask(request, new ByteLimit()),
        () => client.getCrawlStatus('known', new ByteLimit()),
        () => client.listCrawlPages('known', {}, new ByteLimit()),
        () => client.readStorage('opaque', new ByteLimit()),
    ]) {
        await assert.rejects(run(), /maxResponseBytes/);
    }
    class Deadline {
        get timeoutMs() { return 0; }
    }
    await assert.rejects(client.getCrawlStatus('known', new Deadline()), /timeoutMs/);
    const cancelled = AbortSignal.abort();
    class Cancellation {
        get signal() { return cancelled; }
    }
    await assert.rejects(client.getCrawlStatus('known', new Cancellation()), { name: 'AbortError' });
});

test('deferred getter overrides retain inherited controls and explicit undefined semantics', async () => {
    const stored = 'x'.repeat(2048);
    const client = new NstDataClient('fixture-token', {
        fetch: async url => url.includes('/storage/read') ? new Response(stored)
            : envelope({ data: { markdownRef: 'opaque' } }),
    });
    const getData = async () => (await client.getScrapeTaskResult('known', { maxResponseBytes: 1024 })).data;
    class DeadlineOnly {
        get timeoutMs() { return 1000; }
    }
    await assert.rejects((await getData()).getMarkdown(new DeadlineOnly()), /maxResponseBytes/);
    class RaisedLimit {
        get maxResponseBytes() { return 4096; }
    }
    assert.equal(await (await getData()).getMarkdown(new RaisedLimit()), stored);
    class Unbounded {
        get maxResponseBytes() { return undefined; }
    }
    assert.equal(await (await getData()).getMarkdown(new Unbounded()), stored);
    assert.equal(await (await getData()).getMarkdown({ maxResponseBytes: undefined }), stored);
    const cancelled = AbortSignal.abort();
    class Cancellation {
        get signal() { return cancelled; }
    }
    await assert.rejects((await getData()).getMarkdown(new Cancellation()), { name: 'AbortError' });
});
