import * as fs from 'fs';
import { NstDataClient, Format, ActionBuilder, TaskStatus, TaskType } from './src';

// It's recommended to load the token from an environment variable for security
const TOKEN = process.env.NSTDATA_API_TOKEN;

// Scenario 1: Basic scrape, synchronously return markdown and html
async function exampleBasicScrape(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN, Format.HTML],
        timeout: 60000,
    });
    console.log(await res.data?.getMarkdown());
}

// Scenario 2: Full page screenshot
async function exampleScreenshot(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.SCREENSHOT],
        jsRender: {
            waitFor: 3000,
            actions: [ActionBuilder.screenshot(true)],
        },
        timeout: 60000,
    });
    console.log(await res.data?.getScreenshot());
}

// Scenario 3: Export page to PDF
async function examplePdf(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.PDF],
        timeout: 60000,
    });
    console.log(await res.data?.getPdf());
}

// Scenario 4: Browser action orchestration
async function exampleBrowserActions(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        jsRender: {
            waitForSelector: "body",
            actions: [
                ActionBuilder.waitSelector("h1", 5000),
                ActionBuilder.fill("#search-input", "hello"),
                ActionBuilder.click("#search-button"),
                ActionBuilder.wait(1000),
                ActionBuilder.scrollY(800),
                ActionBuilder.executeJs("window.scrollTo(0, document.body.scrollHeight)"),
                ActionBuilder.waitForRequest("*example.com/api/*", 10000),
            ],
        },
        timeout: 60000,
    });
    console.log(await res.data?.getMarkdown());
}

// Scenario 5: Bring Cookies, custom headers, simulate mobile device
async function exampleCookiesAndHeaders(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.HTML],
        cookies: [
            { name: "session_id", value: "abc123", domain: "example.com", path: "/", secure: true },
        ],
        headers: {
            "Referer": "https://example.com/home",
        },
        mobile: true,
        timeout: 60000,
    });
    console.log(await res.data?.getHtml());
}

// Scenario 6: Main content extraction and filtering
async function exampleContentFilter(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        onlyMainContent: true,
        includeTags: ["main", "article"],
        excludeTags: ["nav", "footer"],
        targetSelector: "main article",
        removeSelectors: [".ads", "#popup"],
        timeout: 60000,
    });
    console.log(await res.data?.getMarkdown());
}

// Scenario 7: Specify proxy exit country
async function exampleCountry(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        country: "us",
        timeout: 60000,
    });
    console.log(await res.data?.getMarkdown());
}

// Scenario 8: Asynchronous submission + polling results
async function exampleAsyncPolling(client: NstDataClient) {
    const submitted = await client.submitScrapeTask({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        timeout: 60000,
    });
    console.log("task id:", submitted.id);

    while (true) {
        const res = await client.getScrapeTaskResult(submitted.id!);
        if (res.status === TaskStatus.COMPLETED) {
            console.log(await res.data?.getMarkdown());
            return;
        }
        if (res.status === TaskStatus.FAILED) {
            throw new Error(`task failed: ${res.errorCode} ${res.errorMessage}`);
        }
        await new Promise(r => setTimeout(r, 3000));
    }
}


// Scenario 11: Extract links and raw data
async function exampleLinksAndRawData(client: NstDataClient) {
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.LINKS, Format.RAW_DATA],
        timeout: 60000,
    });
    for (const link of (res.data?.links || [])) {
        console.log(link);
    }
    console.log("rawData length:", (await res.data?.getRawData())?.length || 0);
}

// Scenario 12: Submit batch crawl tasks
async function exampleCrawl(client: NstDataClient) {
    const submitted = await client.submitCrawlTask({
        url: "https://example.com/",
        maxDepth: 3,
        maxPages: 10,
        includeUrls: ["*example.com/blog/*", "*/docs/*"],
        excludeUrls: ["*example.com/admin/*"],
        ignoreQuery: true,
        formats: [Format.MARKDOWN],
        onlyMainContent: true,
        timeout: 60000,
    });
    console.log("crawl task id:", submitted.id);

    while (true) {
        const st = await client.getCrawlStatus(submitted.id!);
        console.log(`status=${st.status} total=${st.total} completed=${st.completed} failed=${st.failed} pending=${st.pending}`);
        if (st.status === TaskStatus.COMPLETED || st.status === TaskStatus.FAILED) break;
        await new Promise(r => setTimeout(r, 3000));
    }

    let cursor: string | undefined = undefined;
    while (true) {
        const pages = await client.listCrawlPages(submitted.id!, { afterCursor: cursor, limit: 20 });
        for (const page of (pages.data || [])) {
            console.log("==", page.url, page.status);
            if (page.success && page.data) {
                let md = await page.data.getMarkdown();
                console.log(md);
            } else if (page.errorMessage) {
                console.log("error:", page.errorCode, page.errorMessage);
            }
        }
        if (!pages.nextCursor) break;
        cursor = pages.nextCursor;
    }
}

async function main() {
    if (TOKEN === "YOUR_API_TOKEN") {
        console.log("Please set your API token by modifying TOKEN or setting NSTDATA_API_TOKEN env var");
        return;
    }

    const client = new NstDataClient(TOKEN);
    // Uncomment the scenario you want to run
    await exampleBasicScrape(client);
    // await exampleScreenshot(client);
    // await examplePdf(client);
    // await exampleBrowserActions(client);
    // await exampleCookiesAndHeaders(client);
    // await exampleContentFilter(client);
    // await exampleCountry(client);
    // await exampleAsyncPolling(client);
    // await exampleLinksAndRawData(client);
    // await exampleCrawl(client);
}

main().catch(console.error);
