const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once, getEventListeners } = require('node:events');
const { NstDataClient, NstDataApiError } = require('../dist');

async function withServer(handler, run) {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        const closed = new Promise(resolve => server.close(resolve));
        server.closeAllConnections();
        await closed;
    }
}

test('API and storage refuse redirects without forwarding credentials or replaying creation', { timeout: 10000 }, async () => {
    let destinationCalls = 0;
    const reply = res => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ code: 200, err: false, data: { status: 'completed', success: true } }));
    };
    await withServer((_req, res) => { destinationCalls++; reply(res); }, async destination => {
        for (const status of [301, 302, 303, 307, 308]) {
            for (const sameOrigin of [false, true]) {
                for (const operation of ['submit', 'status', 'storage', 'lazy storage']) {
                    let sourceCalls = 0, sameOriginDestinationCalls = 0;
                    await withServer((req, res) => {
                        if (req.url === '/redirected') {
                            sameOriginDestinationCalls++; reply(res); return;
                        }
                        sourceCalls++;
                        if (operation === 'lazy storage' && !req.url.includes('/storage/read')) {
                            res.setHeader('Content-Type', 'application/json');
                            res.end(JSON.stringify({ code: 200, err: false, data: {
                                status: 'completed', success: true, data: { markdownRef: 'opaque' },
                            } }));
                            return;
                        }
                        res.writeHead(status, { Location: sameOrigin ? '/redirected' : destination + '/redirected' });
                        res.end();
                    }, async baseURL => {
                        const client = new NstDataClient('synthetic-credential', { baseURL, timeoutMs: 1000 });
                        let result;
                        if (operation === 'submit') result = client.submitScrapeTaskSync({ url: 'https://target.invalid', formats: ['markdown'] });
                        else if (operation === 'status') result = client.getCrawlStatus('known');
                        else if (operation === 'storage') result = client.readStorage('opaque');
                        else result = (await client.getScrapeTaskResult('known')).data.getMarkdown();
                        await assert.rejects(result, error => error instanceof NstDataApiError && error.statusCode === status);
                        assert.equal(sourceCalls, operation === 'lazy storage' ? 2 : 1);
                        assert.equal(sameOriginDestinationCalls, 0);
                        assert.equal(destinationCalls, 0);
                    });
                }
            }
        }
    });
});

for (const kind of ['api headers', 'api body', 'storage headers', 'storage body']) {
    for (const cancel of [false, true]) {
        test(`${cancel ? 'cancels' : 'times out'} stalled ${kind}`, { timeout: 5000 }, async (t) => {
            const controller = new AbortController();
            let headersReceived = false;
            if (cancel && kind.endsWith('body')) {
                const fetch = globalThis.fetch;
                t.mock.method(globalThis, 'fetch', async (...args) => {
                    const response = await fetch(...args);
                    headersReceived = true;
                    setImmediate(() => controller.abort());
                    return response;
                });
            }
            await withServer((req, res) => {
                if (kind.endsWith('body')) {
                    res.writeHead(200, { 'Content-Type': kind.startsWith('api') ? 'application/json' : 'text/plain' });
                    res.write(kind.startsWith('api') ? '{"code":' : 'partial');
                }
                if (cancel && !kind.endsWith('body')) controller.abort();
            }, async (baseURL) => {
                const client = new NstDataClient('test-token', { baseURL, timeoutMs: cancel ? 3000 : 100 });
                const options = { signal: controller.signal };
                const result = kind.startsWith('api')
                    ? client.getCrawlStatus('id', options)
                    : client.readStorage('ref', options);
                await assert.rejects(result, { name: cancel ? 'AbortError' : 'TimeoutError' });
                assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
                if (cancel && kind.endsWith('body')) assert.equal(headersReceived, true);
            });
        });
    }
}

test('per-call timeout overrides the client timeout', { timeout: 5000 }, async () => {
    await withServer(() => {}, async (baseURL) => {
        const client = new NstDataClient('test-token', { baseURL, timeoutMs: 3000 });
        await assert.rejects(client.getCrawlStatus('id', { timeoutMs: 40 }), { name: 'TimeoutError' });
    });
});

test('a getter accepts its own deadline and retries a failed download only when called again', { timeout: 5000 }, async () => {
    let storageCalls = 0;
    await withServer((req, res) => {
        if (req.url.includes('storage/read')) {
            storageCalls++;
            if (storageCalls === 2) res.end('# Retry');
        } else {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ code: 200, err: false, data: { data: { markdownRef: 'ref' } } }));
        }
    }, async (baseURL) => {
        const client = new NstDataClient('test-token', { baseURL, timeoutMs: 3000 });
        const result = await client.getScrapeTaskResult('id');
        await assert.rejects(result.data.getMarkdown({ timeoutMs: 40 }), { name: 'TimeoutError' });
        assert.equal(storageCalls, 1);
        assert.equal(await result.data.getMarkdown(), '# Retry');
        assert.equal(storageCalls, 2);
    });
});
