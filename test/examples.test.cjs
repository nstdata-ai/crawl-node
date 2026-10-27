const { test } = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register();
const { exampleAsyncPolling, exampleCrawl } = require('../example.ts');

test('polling stops immediately for an already cancelled operation', async () => {
    const client = { submitScrapeTask: () => assert.fail('must not submit') };
    await assert.rejects(exampleAsyncPolling(client, AbortSignal.abort()), { name: 'AbortError' });
});

test('polling stops on a failed result without trying to read data', async () => {
    const client = {
        submitScrapeTask: async () => ({ id: 'fixture-id' }),
        getScrapeTaskResult: async () => ({ status: 'failed', success: false, errorCode: 'FIXTURE_FAILURE' }),
    };
    await assert.rejects(exampleAsyncPolling(client), /Scrape task failed/);
});

test('polling requires a task ID', async () => {
    await assert.rejects(exampleAsyncPolling({ submitScrapeTask: async () => ({}) }), /no task ID/);
});

test('cancellation interrupts the polling interval', async () => {
    const controller = new AbortController();
    const client = {
        submitScrapeTask: async () => ({ id: 'fixture-id' }),
        getScrapeTaskResult: async () => { controller.abort(); return { status: 'processing' }; },
    };
    await assert.rejects(exampleAsyncPolling(client, controller.signal), { name: 'AbortError' });
});

test('a failed crawl does not fetch pages', async () => {
    const client = {
        submitCrawlTask: async () => ({ id: 'fixture-id' }),
        getCrawlStatus: async () => ({ status: 'failed' }),
        listCrawlPages: () => assert.fail('must not fetch pages'),
    };
    await assert.rejects(exampleCrawl(client), /Crawl task failed/);
});

test('crawl example refuses unfinished or unknown page states before reading content', async t => {
    const printed = [];
    t.mock.method(console, 'log', (...args) => printed.push(args));
    for (const status of ['processing', 'scraping', 'unexpected', undefined]) {
        let reads = 0;
        const client = {
            submitCrawlTask: async () => ({ id: 'known-crawl' }),
            getCrawlStatus: async () => ({ status: 'completed' }),
            listCrawlPages: async () => ({ data: [{ status, success: true,
                data: { getMarkdown: async () => { reads++; return 'partial-content'; } } }] }),
        };
        await assert.rejects(exampleCrawl(client), /No completed crawl page/);
        assert.equal(reads, 0);
    }
    assert.ok(printed.every(args => !args.includes('partial-content')));
});

test('expired scrape and crawl tasks stop without polling or reading pages', async () => {
    let scrapePolls = 0;
    const scrape = {
        submitScrapeTask: async () => ({ id: 'expired-task' }),
        getScrapeTaskResult: async () => { scrapePolls++; return { status: 'expired' }; },
    };
    await assert.rejects(exampleAsyncPolling(scrape), /Scrape task failed/);
    assert.equal(scrapePolls, 1);
    const crawl = {
        submitCrawlTask: async () => ({ id: 'expired-crawl' }),
        getCrawlStatus: async () => ({ status: 'expired' }),
        listCrawlPages: () => assert.fail('must not read pages for an expired crawl'),
    };
    await assert.rejects(exampleCrawl(crawl), /Crawl task expired/);
});

test('crawl pagination stops on an empty final page and detects repeated cursors', async () => {
    for (const repeat of [false, true]) {
        let calls = 0;
        const client = {
            submitCrawlTask: async () => ({ id: 'fixture-id' }),
            getCrawlStatus: async () => ({ status: 'completed' }),
            listCrawlPages: async () => ({ data: [], nextCursor: ++calls === 1 || repeat ? 'cursor' : undefined }),
        };
        if (repeat) await assert.rejects(exampleCrawl(client), /Repeated pagination cursor/);
        else await exampleCrawl(client);
        assert.equal(calls, 2);
    }
});

test('polling has a request bound even when the caller provides an unbounded signal', async t => {
    t.mock.method(require('node:timers/promises'), 'setTimeout', async () => {});
    for (const kind of ['scrape', 'crawl']) {
        let submissions = 0, polls = 0;
        const client = kind === 'scrape' ? {
            submitScrapeTask: async () => { submissions++; return { id: 'known-task' }; },
            getScrapeTaskResult: async () => { polls++; return { status: 'processing' }; },
        } : {
            submitCrawlTask: async () => { submissions++; return { id: 'known-crawl' }; },
            getCrawlStatus: async () => { polls++; return { status: 'scraping' }; },
            listCrawlPages: () => assert.fail('must not read pending pages'),
        };
        await assert.rejects((kind === 'scrape' ? exampleAsyncPolling : exampleCrawl)(client, new AbortController().signal), /polling limit reached/);
        assert.equal(submissions, 1); assert.equal(polls, 20);
    }
});

test('pagination stops after100 distinct cursors without creating another crawl', async () => {
    let submissions = 0, batches = 0;
    const client = {
        submitCrawlTask: async () => { submissions++; return { id: 'known-crawl' }; },
        getCrawlStatus: async () => ({ status: 'completed' }),
        listCrawlPages: async () => ({ data: [], nextCursor: `cursor-${++batches}` }),
    };
    await assert.rejects(exampleCrawl(client, new AbortController().signal), /pagination limit reached/);
    assert.equal(submissions, 1); assert.equal(batches, 100);
});

test('unexpected states and completed results without Markdown fail before more polling', async () => {
    for (const status of ['unexpected', 'completed']) {
        let calls = 0;
        const client = {
            submitScrapeTask: async () => ({ id: 'known-task' }),
            getScrapeTaskResult: async () => { calls++; return { status, data: { getMarkdown: async () => undefined } }; },
        };
        await assert.rejects(exampleAsyncPolling(client), status === 'completed' ? /No Markdown/ : /Unexpected scrape status/);
        assert.equal(calls, 1);
    }
    await assert.rejects(exampleCrawl({
        submitCrawlTask: async () => ({ id: 'known-crawl' }),
        getCrawlStatus: async () => ({ status: 'completed', failed: 1 }),
        listCrawlPages: () => assert.fail('must not treat a partially failed crawl as success'),
    }), /Crawl contains failed pages/);
});

test('a known nonempty completed crawl cannot finish without reading a page', async () => {
    const client = {
        submitCrawlTask: async () => ({ id: 'known-crawl' }),
        getCrawlStatus: async () => ({ status: 'completed', total: 2, completed: 2 }),
        listCrawlPages: async () => ({ total: 2, data: [] }),
    };
    await assert.rejects(exampleCrawl(client), /No crawl pages returned/);
    client.getCrawlStatus = async () => ({ status: 'completed', total: 0, completed: 0 });
    client.listCrawlPages = async () => ({ total: 0, data: [] });
    await exampleCrawl(client);
});

test('async workflow resumes an existing task without another submission', async () => {
    const state = { taskId: 'existing-task' };
    const client = {
        submitScrapeTask: () => assert.fail('must not create another task'),
        getScrapeTaskResult: async id => {
            assert.equal(id, state.taskId);
            return { status: 'completed', data: { getMarkdown: async () => '# Existing' } };
        },
    };
    await exampleAsyncPolling(client, new AbortController().signal, state);
});

test('crawl workflow retains a usable cursor after failure and resumes without creation', async () => {
    const state = {};
    let fail = true;
    const client = {
        submitCrawlTask: async () => ({ id: 'existing-crawl' }),
        getCrawlStatus: async () => ({ status: 'completed', total: 2, completed: 2 }),
        listCrawlPages: async (_id, paging) => {
            if (!paging.afterCursor) return {
                data: [{ status: 'completed', data: { getMarkdown: async () => '# First' } }],
                nextCursor: 'opaque-next',
            };
            assert.equal(paging.afterCursor, 'opaque-next');
            if (fail) throw new Error('synthetic read failure');
            return { data: [] };
        },
    };
    await assert.rejects(exampleCrawl(client, new AbortController().signal, state), /synthetic read failure/);
    assert.deepEqual(state, { crawlId: 'existing-crawl', afterCursor: 'opaque-next' });
    fail = false;
    client.submitCrawlTask = () => assert.fail('must not create another crawl');
    await exampleCrawl(client, new AbortController().signal, state);
    assert.deepEqual(state, { crawlId: 'existing-crawl', afterCursor: null });
    client.getCrawlStatus = () => assert.fail('a completed state must not be queried again');
    client.listCrawlPages = () => assert.fail('a completed state must not restart pagination');
    await exampleCrawl(client, new AbortController().signal, state);
});

test('a recovery cursor without its crawl ID never creates a new task', async () => {
    const client = { submitCrawlTask: () => assert.fail('must not create a task for an orphan cursor') };
    await assert.rejects(exampleCrawl(client, new AbortController().signal, {
        afterCursor: 'existing-cursor',
    }), /crawl ID is required/);
});

test('a resumed crawl rejects a nonadvancing cursor without requesting the same batch again', async () => {
    let reads = 0;
    const state = { crawlId: 'existing-crawl', afterCursor: 'existing-cursor' };
    await assert.rejects(exampleCrawl({
        getCrawlStatus: async () => ({ status: 'completed' }),
        listCrawlPages: async () => {
            reads++;
            return { data: [], nextCursor: 'existing-cursor' };
        },
    }, new AbortController().signal, state), /Repeated pagination cursor/);
    assert.equal(reads, 1);
    assert.equal(state.afterCursor, 'existing-cursor');
});

test('an explicitly invalid saved ID never becomes a new submission', async () => {
    for (const id of ['', '   ', null]) {
        const client = {
            submitScrapeTask: () => assert.fail('must not submit another scrape'),
            submitCrawlTask: () => assert.fail('must not submit another crawl'),
        };
        await assert.rejects(exampleAsyncPolling(client, new AbortController().signal, {
            taskId: id,
        }), /existing task ID/);
        await assert.rejects(exampleCrawl(client, new AbortController().signal, {
            crawlId: id,
        }), /existing crawl ID/);
    }
});
