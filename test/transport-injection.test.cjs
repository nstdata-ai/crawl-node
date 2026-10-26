const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { NstDataClient } = require('../dist');

test('per-client fetch observes API and lazy storage without replacing global transport', { timeout: 5000 }, async t => {
    const calls = [], original = globalThis.fetch;
    const server = http.createServer((req, res) => {
        if (req.url.includes('/storage/read')) return res.end('# Stored fixture');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 200, err: false, data: { status: 'completed', success: true, data: { markdownRef: 'stored' } } }));
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const observed = new NstDataClient('fixture-token', { baseURL, fetch: async (url, init) => { calls.push({ url, signal: init.signal, redirect: init.redirect }); return original(url, init); } });
    const result = await observed.submitScrapeTaskSync({ url: 'https://example.com', formats: ['markdown'] });
    assert.equal(await result.data.getMarkdown(), '# Stored fixture');
    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.endsWith('/api/v1/crawl/scrape'));
    assert.ok(calls[1].url.endsWith('/api/v1/crawl/storage/read?st=stored'));
    assert.ok(calls.every(call => call.signal instanceof AbortSignal));
    assert.ok(calls.every(call => call.redirect === 'manual'));
    const normal = new NstDataClient('fixture-token', { baseURL });
    await normal.getCrawlStatus('existing');
    assert.equal(calls.length, 2); assert.equal(globalThis.fetch, original);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(observed.readStorage('stored', { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls.length, 2);
});

test('invalid per-client fetch is rejected at construction', () => {
    for (const fetch of [null, false, 'fetch', {}]) assert.throws(() => new NstDataClient('fixture-token', { fetch }), /fetch/);
});
