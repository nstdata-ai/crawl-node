const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { NstDataClient, NstDataApiError } = require('../dist');

// Contract: public Crawl controllers/gateway inspected on 2026-10-15.
// Synthetic responses exercise the source-confirmed contract, not the live service.
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const ok = data => Response.json({ code: 200, err: false, msg: 'SUCCESS', data });

test('uses the official origin and source-confirmed single-page sync/async operations', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return url.endsWith('?async=true')
            ? ok({ id: 'task', status: 'processing' })
            : ok({ success: true, status: 'completed', data: { markdown: '# Page' } });
    };
    const client = new NstDataClient('fixture-token');
    const request = { url: 'https://example.com', formats: ['markdown'], onlyMainContent: true };
    const sync = await client.submitScrapeTaskSync(request);
    assert.equal(await sync.data.getMarkdown(), '# Page');
    assert.equal((await client.submitScrapeTask(request)).id, 'task');
    assert.deepEqual(calls.map(call => call.url), [
        'https://api.nstdata.io/api/v1/crawl/scrape',
        'https://api.nstdata.io/api/v1/crawl/scrape?async=true',
    ]);
    for (const { init } of calls) {
        assert.equal(init.method, 'POST');
        assert.equal(init.headers['x-api-key'], 'fixture-token');
        assert.deepEqual(JSON.parse(init.body), request);
    }
});

test('uses source-confirmed result/status/pages routes and retains raw storage bytes', async () => {
    const calls = [];
    const bytes = Uint8Array.from([0, 255, 1, 128]);
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        if (url.includes('storage/read')) return new Response(bytes);
        if (new URL(url).pathname.endsWith('/pages')) return ok({ total: 1, nextCursor: 'next', data: [] });
        return ok({ id: 'task', status: 'completed' });
    };
    const client = new NstDataClient('fixture-token');
    await client.getScrapeTaskResult('id /?');
    await client.submitCrawlTask({ url: 'https://example.com', formats: ['markdown'], maxPages: 1 });
    await client.getCrawlStatus('id /?');
    const pages = await client.listCrawlPages('id /?', { afterCursor: 'a /&', limit: 1 });
    assert.equal(pages.nextCursor, 'next');
    assert.deepEqual(new Uint8Array(await client.readStorage('ref /&')), bytes);
    assert.deepEqual(calls.map(call => call.url.replace('https://api.nstdata.io', '')), [
        '/api/v1/crawl/scrape/id%20%2F%3F',
        '/api/v1/crawl',
        '/api/v1/crawl/id%20%2F%3F',
        '/api/v1/crawl/id%20%2F%3F/pages?after_cursor=a+%2F%26&limit=1',
        '/api/v1/crawl/storage/read?st=ref%20%2F%26',
    ]);
    assert.deepEqual(calls.map(call => call.init.method), ['GET', 'POST', 'GET', 'GET', undefined]);
});

test('reports structured HTTP and API errors without exposing response bodies or the token', async () => {
    assert.equal(typeof NstDataApiError, 'function');
    const token = 'fixture-secret-value';
    const client = new NstDataClient(token);
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(`echo ${token}`, { status: 429 }); };
    await assert.rejects(client.submitScrapeTask({ url: 'https://example.com', formats: ['markdown'] }), error => {
        assert.ok(error instanceof NstDataApiError);
        assert.equal(error.statusCode, 429);
        assert.equal(error.message.includes(token), false);
        assert.equal(error.message.includes('echo'), false);
        return true;
    });
    assert.equal(calls, 1);
    globalThis.fetch = async () => Response.json({ code: 403, err: true, msg: `denied ${token}` });
    await assert.rejects(client.getCrawlStatus('task'), error => {
        assert.ok(error instanceof NstDataApiError);
        assert.equal(error.statusCode, 200);
        assert.equal(error.code, 403);
        assert.match(error.message, /denied/);
        assert.equal(error.message.includes(token), false);
        return true;
    });
});

test('invalid JSON is actionable without leaking the response content', async () => {
    globalThis.fetch = async () => new Response('private response body');
    await assert.rejects(new NstDataClient('fixture-token').getCrawlStatus('task'), error => {
        assert.match(error.message, /invalid JSON/i);
        assert.equal(error.message.includes('private response'), false);
        return true;
    });
});

test('a configured response byte limit bounds JSON and streaming storage downloads', async () => {
    const client = new NstDataClient('fixture-token');
    globalThis.fetch = async () => ok({ status: 'completed', privateContent: 'x'.repeat(100) });
    await assert.rejects(client.getCrawlStatus('task', { maxResponseBytes: 32 }), /maxResponseBytes/);
    globalThis.fetch = async () => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array(20));
            controller.enqueue(new Uint8Array(20));
            controller.close();
        },
    }));
    await assert.rejects(client.readStorage('ref', { maxResponseBytes: 32 }), /maxResponseBytes/);
    globalThis.fetch = async () => new Response(Uint8Array.from([0, 255, 1]));
    assert.deepEqual(new Uint8Array(await client.readStorage('ref', { maxResponseBytes: 3 })), Uint8Array.from([0, 255, 1]));
});
