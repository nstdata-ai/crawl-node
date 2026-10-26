import { setTimeout as delay } from 'node:timers/promises';
import { NstDataClient, NstDataApiError, Format, TaskStatus } from './src';
import type { TaskResultResponseDto, ScrapeDataDto } from './src';

class WorkflowError extends Error {}

function resultData(res: TaskResultResponseDto): ScrapeDataDto {
    if (res.success === false
        || res.status === TaskStatus.FAILED
        || res.status === TaskStatus.EXPIRED) {
        throw new WorkflowError('Scrape task failed');
    }
    if (res.status !== TaskStatus.COMPLETED || !res.data) {
        throw new WorkflowError('No completed scrape data returned');
    }
    return res.data;
}

async function exampleBasicScrape(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: 'https://example.com/',
        formats: [Format.MARKDOWN],
        onlyMainContent: true,
        timeout: 60000,
    }, { maxResponseBytes: 1048576 });
    const markdown = await resultData(res).getMarkdown();
    if (markdown === undefined) throw new WorkflowError('No Markdown content returned');
    console.log(markdown);
}

export async function exampleAsyncPolling(
    client: NstDataClient,
    signal = AbortSignal.timeout(120000),
    state: { taskId?: string } = {},
) {
    signal.throwIfAborted();
    if (state.taskId !== undefined && (typeof state.taskId !== 'string' || !state.taskId.trim())) {
        throw new WorkflowError('The existing task ID must be a nonempty string');
    }
    const options = { signal, maxResponseBytes: 1048576 };
    if (state.taskId === undefined) {
        const submitted = await client.submitScrapeTask({
            url: 'https://example.com/',
            formats: [Format.MARKDOWN],
            timeout: 60000,
        }, options);
        if (!submitted.id?.trim()) throw new WorkflowError('Submission returned no task ID');
        state.taskId = submitted.id;
        console.log('task id:', state.taskId);
    }
    for (let poll = 0; poll < 20; poll++) {
        signal.throwIfAborted();
        const res = await client.getScrapeTaskResult(state.taskId, options);
        if (res.success === false
            || res.status === TaskStatus.FAILED
            || res.status === TaskStatus.EXPIRED) {
            throw new WorkflowError('Scrape task failed');
        }
        if (res.status === TaskStatus.COMPLETED) {
            const markdown = await resultData(res).getMarkdown();
            if (markdown === undefined) throw new WorkflowError('No Markdown content returned');
            console.log(markdown);
            return;
        }
        if (res.status !== TaskStatus.PROCESSING && res.status !== TaskStatus.SCRAPING) {
            throw new WorkflowError('Unexpected scrape status');
        }
        if (poll < 19) await delay(3000, undefined, { signal });
    }
    throw new WorkflowError('Scrape polling limit reached; retain the existing task ID');
}

export async function exampleCrawl(
    client: NstDataClient,
    signal = AbortSignal.timeout(120000),
    state: { crawlId?: string; afterCursor?: string | null } = {},
) {
    signal.throwIfAborted();
    if (state.crawlId !== undefined && (typeof state.crawlId !== 'string' || !state.crawlId.trim())) {
        throw new WorkflowError('The existing crawl ID must be a nonempty string');
    }
    if (state.afterCursor !== undefined && !state.crawlId) {
        throw new WorkflowError('A crawl ID is required to resume from a cursor');
    }
    if (state.afterCursor === null) return;
    const options = { signal, maxResponseBytes: 1048576 };
    if (state.crawlId === undefined) {
        const submitted = await client.submitCrawlTask({
            url: 'https://example.com/',
            maxDepth: 1,
            maxPages: 10,
            formats: [Format.MARKDOWN],
            onlyMainContent: false,
            timeout: 60000,
        }, options);
        if (!submitted.id?.trim()) throw new WorkflowError('Submission returned no crawl ID');
        state.crawlId = submitted.id;
        console.log('crawl task id:', state.crawlId);
    }
    let expectsPages = false;
    for (let poll = 0; ; poll++) {
        signal.throwIfAborted();
        const status = await client.getCrawlStatus(state.crawlId, options);
        if (status.status === TaskStatus.FAILED || status.status === TaskStatus.EXPIRED) {
            throw new WorkflowError(`Crawl task ${status.status}`);
        }
        if (status.status === TaskStatus.COMPLETED) {
            if (status.failed && status.failed > 0) throw new WorkflowError('Crawl contains failed pages');
            expectsPages = (status.completed ?? status.total ?? 0) > 0;
            break;
        }
        if (status.status !== TaskStatus.PROCESSING && status.status !== TaskStatus.SCRAPING) {
            throw new WorkflowError('Unexpected crawl status');
        }
        if (poll === 19) {
            throw new WorkflowError('Crawl polling limit reached; retain the existing crawl ID');
        }
        await delay(3000, undefined, { signal });
    }
    const fromBeginning = !state.afterCursor;
    const cursors = new Set<string>();
    if (state.afterCursor) cursors.add(state.afterCursor);
    let pageCount = 0;
    for (let batch = 0; batch < 100; batch++) {
        signal.throwIfAborted();
        const pages = await client.listCrawlPages(state.crawlId, {
            afterCursor: state.afterCursor,
            limit: 20,
        }, options);
        expectsPages ||= (pages.total ?? 0) > 0;
        for (const page of pages.data ?? []) {
            if (page.success === false
                || page.status === TaskStatus.FAILED
                || page.status === TaskStatus.EXPIRED) {
                throw new WorkflowError('Crawl page failed');
            }
            if (page.status !== TaskStatus.COMPLETED) {
                throw new WorkflowError('No completed crawl page returned');
            }
            const markdown = await page.data?.getMarkdown();
            if (markdown === undefined) {
                throw new WorkflowError('No Markdown content returned for crawl page');
            }
            console.log(page.url ?? '(page URL unavailable)', markdown);
            pageCount++;
        }
        if (!pages.nextCursor) {
            if (fromBeginning && expectsPages && pageCount === 0) {
                throw new WorkflowError('No crawl pages returned for a nonempty completed task');
            }
            state.afterCursor = null;
            return;
        }
        if (cursors.has(pages.nextCursor)) throw new WorkflowError('Repeated pagination cursor');
        cursors.add(pages.nextCursor);
        // Advance only after every page in this batch has been consumed.
        state.afterCursor = pages.nextCursor;
    }
    throw new WorkflowError('Crawl pagination limit reached; retain the existing crawl ID and cursor');
}

async function main() {
    const token = process.env.NSTDATA_API_TOKEN;
    if (!token?.trim()) throw new WorkflowError('Set NSTDATA_API_TOKEN locally');
    await exampleBasicScrape(new NstDataClient(token));
}

if (require.main === module) {
    main().catch(error => {
        if (error instanceof NstDataApiError) {
            console.error('API request failed', { statusCode: error.statusCode, code: error.code });
        } else if (error instanceof WorkflowError) {
            console.error(error.message);
        } else if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
            console.error(`${error.name}: local waiting stopped; retain the existing task state.`);
        } else {
            console.error('Transport or content decoding failed; check connectivity and requested formats.');
        }
        process.exitCode = 1;
    });
}
