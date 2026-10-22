import { setTimeout as delay } from 'node:timers/promises';
import { NstDataClient, Format, TaskStatus, TaskResultResponseDto, ScrapeDataDto } from './src';

function resultData(res: TaskResultResponseDto): ScrapeDataDto {
    if (res.success === false || res.status === TaskStatus.FAILED || res.status === TaskStatus.EXPIRED) {
        throw new Error('Scrape task failed');
    }
    if (res.status !== TaskStatus.COMPLETED || !res.data) throw new Error('No completed scrape data returned');
    return res.data;
}

async function exampleBasicScrape(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: 'https://example.com/', formats: [Format.MARKDOWN], onlyMainContent: true, timeout: 60000,
    }, { maxResponseBytes: 1048576 });
    const markdown = await resultData(res).getMarkdown();
    if (markdown === undefined) throw new Error('No Markdown content returned');
    console.log(markdown);
}

export async function exampleAsyncPolling(client: NstDataClient, signal = AbortSignal.timeout(120000)) {
    signal.throwIfAborted();
    const options = { signal, maxResponseBytes: 1048576 };
    const submitted = await client.submitScrapeTask({
        url: 'https://example.com/', formats: [Format.MARKDOWN], timeout: 60000,
    }, options);
    if (!submitted.id) throw new Error('Submission returned no task ID');
    // Retain this ID if local waiting stops; do not submit the task again.
    console.log('task id:', submitted.id);
    for (let poll = 0; poll < 20; poll++) {
        signal.throwIfAborted();
        const res = await client.getScrapeTaskResult(submitted.id, options);
        if (res.success === false || res.status === TaskStatus.FAILED || res.status === TaskStatus.EXPIRED) {
            throw new Error('Scrape task failed');
        }
        if (res.status === TaskStatus.COMPLETED) {
            const markdown = await resultData(res).getMarkdown();
            if (markdown === undefined) throw new Error('No Markdown content returned');
            console.log(markdown);
            return;
        }
        if (res.status !== TaskStatus.PROCESSING && res.status !== TaskStatus.SCRAPING) throw new Error('Unexpected scrape status');
        if (poll < 19) await delay(3000, undefined, { signal });
    }
    throw new Error('Scrape polling limit reached; retain the existing task ID');
}

export async function exampleCrawl(client: NstDataClient, signal = AbortSignal.timeout(120000)) {
    signal.throwIfAborted();
    const options = { signal, maxResponseBytes: 1048576 };
    const submitted = await client.submitCrawlTask({
        url: 'https://example.com/', maxDepth: 1, maxPages: 10,
        formats: [Format.MARKDOWN], onlyMainContent: true, timeout: 60000,
    }, options);
    if (!submitted.id) throw new Error('Submission returned no crawl ID');
    console.log('crawl task id:', submitted.id);
    for (let poll = 0; ; poll++) {
        signal.throwIfAborted();
        const status = await client.getCrawlStatus(submitted.id, options);
        if (status.status === TaskStatus.FAILED || status.status === TaskStatus.EXPIRED) throw new Error(`Crawl task ${status.status}`);
        if (status.status === TaskStatus.COMPLETED) {
            if (status.failed && status.failed > 0) throw new Error('Crawl contains failed pages');
            break;
        }
        if (status.status !== TaskStatus.PROCESSING && status.status !== TaskStatus.SCRAPING) throw new Error('Unexpected crawl status');
        if (poll === 19) throw new Error('Crawl polling limit reached; retain the existing crawl ID');
        await delay(3000, undefined, { signal });
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    for (let batch = 0; batch < 100; batch++) {
        signal.throwIfAborted();
        const pages = await client.listCrawlPages(submitted.id, { afterCursor: cursor, limit: 20 }, options);
        for (const page of pages.data ?? []) {
            if (page.success === false || page.status === TaskStatus.FAILED || page.status === TaskStatus.EXPIRED) throw new Error('Crawl page failed');
            if (page.status !== TaskStatus.COMPLETED) throw new Error('No completed crawl page returned');
            const markdown = await page.data?.getMarkdown();
            if (markdown === undefined) throw new Error('No Markdown content returned for crawl page');
            console.log(page.url, markdown);
        }
        if (!pages.nextCursor) return;
        if (cursors.has(pages.nextCursor)) throw new Error('Repeated pagination cursor');
        cursors.add(pages.nextCursor);
        cursor = pages.nextCursor;
    }
    throw new Error('Crawl pagination limit reached; retain the existing crawl ID and cursor');
}

async function main() {
    const token = process.env.NSTDATA_API_TOKEN;
    if (!token?.trim()) throw new Error('Set NSTDATA_API_TOKEN locally');
    await exampleBasicScrape(new NstDataClient(token));
    // Run exampleAsyncPolling or exampleCrawl explicitly when needed; each creates a task.
}

if (require.main === module) {
    main().catch(() => {
        console.error('Example failed; check local configuration and preserve any existing task ID.');
        process.exitCode = 1;
    });
}
