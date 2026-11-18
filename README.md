<p align="center">
  <img src="https://raw.githubusercontent.com/nstdata-ai/nstdata-mcp-server/main/docs/assets/mcp-banner.png" alt="Nstdata — Power AI Agent with Internet Data" width="960">
</p>

<h1 align="center">Nstdata Crawl SDK for Node.js</h1>

<p align="center">Retrieve web content from your Node.js applications through the Nstdata Crawl API.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nstdata-ai/crawl"><img src="https://img.shields.io/npm/v/%40nstdata-ai%2Fcrawl?logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@nstdata-ai/crawl"><img src="https://img.shields.io/npm/dm/%40nstdata-ai%2Fcrawl?logo=npm" alt="npm downloads"></a>
  <a href="https://github.com/nstdata-ai/crawl-node/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://github.com/nstdata-ai/crawl-node/stargazers"><img src="https://img.shields.io/github/stars/nstdata-ai/crawl-node?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://app.nstdata.io/?utm_source=github&amp;utm_medium=social&amp;utm_campaign=crawl-node-sdk&amp;utm_content=readme"><img src="https://img.shields.io/badge/Dashboard-4F46E5?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Dashboard"></a>
  <a href="https://docs.nstdata.io/docs/crawl/?utm_source=github&amp;utm_medium=social&amp;utm_campaign=crawl-node-sdk&amp;utm_content=readme"><img src="https://img.shields.io/badge/Crawl_API_Docs-2563EB?style=for-the-badge&amp;logo=readthedocs&amp;logoColor=white" alt="Crawl API documentation"></a>
  <a href="https://discord.gg/sMsfTzCpe7"><img src="https://img.shields.io/badge/Join_our_Discord-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Join our Discord"></a>
  <a href="https://x.com/nstdata"><img src="https://img.shields.io/badge/Follow_on_X-000000?style=for-the-badge&amp;logo=x&amp;logoColor=white" alt="Follow on X"></a>
</p>

[English](README.md) · [简体中文](README_zh.md)

---

Access the Nstdata Crawl API from your JavaScript and TypeScript applications. Scrape individual pages, submit remote asynchronous tasks, and crawl websites with configurable depth and page limits. Retrieve Markdown, HTML, links, PDFs, screenshots, or raw bytes.

The SDK calls the hosted Nstdata service from your application. MCP and a separate crawler deployment are not required.

[GitHub repository](https://github.com/nstdata-ai/crawl-node) · [Usage guide](docs/guide.md)

## Prerequisites

- Node.js **22.18+ within the 22.x release line**, or **Node.js 24.x**.
- A [Nstdata API key](https://app.nstdata.io/) and available credits. Use the same Nstdata API key used for Crawl requests.

## Install

Install the SDK in your Node.js project. The current release is 2.0.1:

```sh
npm install @nstdata-ai/crawl
```

The package includes TypeScript definitions and supports ESM and CommonJS imports. Upgrading from 1.x? Read the [compatibility notes](CHANGELOG.md#compatibility).

## Authentication

Create a local `.env` file in your application directory:

```dotenv
NSTDATA_API_TOKEN=your-api-key
```

Keep it out of version control. The SDK authenticates with `x-api-key`; keep the key in your server environment. The commands below load `.env` explicitly with Node's `--env-file` option.

## Quick start

Save this complete program as `quickstart.mts`. It submits one page task and prints Markdown; service requests consume credits. Supported Node.js versions run `.mts` directly, without a TypeScript runner or a change to your application's module type.

`quickstart.mts`

```typescript
import { NstDataClient, NstDataApiError, Format } from '@nstdata-ai/crawl';

const token = process.env.NSTDATA_API_TOKEN;
if (!token?.trim()) {
    console.error('Set NSTDATA_API_TOKEN in your environment.');
    process.exit(1);
}
const client = new NstDataClient(token);

async function main() {
    const result = await client.submitScrapeTaskSync({
        url: 'https://example.com/',
        formats: [Format.MARKDOWN],
    });
    if (result.success === false || result.status === 'failed' || result.status === 'expired') {
        console.error('The scrape task failed.');
        process.exitCode = 1;
        return;
    }
    if (result.status !== 'completed' || !result.data) {
        console.error('No completed scrape data was returned.');
        process.exitCode = 1;
        return;
    }
    const markdown = await result.data.getMarkdown();
    if (markdown === undefined) {
        console.error('No Markdown content was returned.');
        process.exitCode = 1;
        return;
    }
    if (result.data.truncated === true) {
        console.error('Warning: service returned truncated content; output is partial.');
    }
    console.log(markdown);
}

main().catch(error => {
    if (error instanceof NstDataApiError) {
        console.error('API request failed', { statusCode: error.statusCode, code: error.code });
    } else if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        console.error(`${error.name}: local waiting stopped.`);
    } else {
        console.error('Transport or response decoding failed.');
    }
    process.exitCode = 1;
});
```

```sh
node --env-file=.env quickstart.mts
```

Content getters read inline content or download referenced content on demand. A missing format is `undefined`; an empty string is valid empty content. A title may appear in `data.metadata.title` without appearing in filtered Markdown.

## Shared client for the following examples

Save `client.mts` in the same directory. Each following example is a separate runnable file using this client and the same `.env` file. Run one workflow at a time.

`client.mts`

```typescript
import { NstDataClient, NstDataApiError } from '@nstdata-ai/crawl';

const token = process.env.NSTDATA_API_TOKEN;
if (!token?.trim()) throw new Error('Set NSTDATA_API_TOKEN in your environment.');
export const client = new NstDataClient(token);

export function reportError(error: unknown): void {
    if (error instanceof NstDataApiError) {
        console.error('API request failed', { statusCode: error.statusCode, code: error.code });
    } else if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) {
        console.error(`${error.name}: local waiting stopped; keep the existing task ID.`);
    } else {
        console.error('Transport or response decoding failed.');
    }
    process.exitCode = 1;
}
```

## Output formats

Request one or more formats and read them only after validating the completed result:

| Format | Access the result | Return type | Common use |
| --- | --- | --- | --- |
| Format.MARKDOWN | await data.getMarkdown() | string or undefined | Text processing and LLM context |
| Format.HTML | await data.getHtml() | string or undefined | HTML parsing and content inspection |
| Format.LINKS | data.links | string[] or undefined | Link collection |
| Format.PDF | await data.getPdf() | Buffer or undefined | Document storage |
| Format.SCREENSHOT | await data.getScreenshot() | Buffer or undefined | Visual inspection |
| Format.RAW_DATA | await data.getRawData() | Buffer or undefined | Raw response processing |

Raw data is bytes, not structured JSON extraction. The following complete example requests HTML and PDF and saves both to new files. It refuses to overwrite existing files.

`formats.mts`

```typescript
import { writeFile } from 'node:fs/promises';
import { Format } from '@nstdata-ai/crawl';
import { client, reportError } from './client.mts';

async function main() {
    const result = await client.submitScrapeTaskSync({
        url: 'https://example.com/',
        formats: [Format.HTML, Format.PDF],
    });
    if (result.success === false || result.status !== 'completed' || !result.data) {
        console.error('No successful completed scrape was returned.');
        process.exitCode = 1;
        return;
    }
    const html = await result.data.getHtml();
    const pdf = await result.data.getPdf();
    if (html === undefined || pdf === undefined) {
        console.error('One or more requested formats were not returned.');
        process.exitCode = 1;
        return;
    }
    try {
        await writeFile('page.html', html, { flag: 'wx' });
        await writeFile('page.pdf', pdf, { flag: 'wx' });
    } catch {
        console.error('Could not save output. Check permissions and existing page.html/page.pdf files.');
        process.exitCode = 1;
        return;
    }
    if (result.data.truncated === true) {
        console.error('Warning: service returned truncated content; output is partial.');
    }
    console.log('Saved page.html and page.pdf');
}
main().catch(reportError);
```

```sh
node --env-file=.env formats.mts
```

## Core workflows

### Submit an asynchronous scrape

Submit once and save the returned task ID before checking status:

`submit-async.mts`

```typescript
import { Format } from '@nstdata-ai/crawl';
import { client, reportError } from './client.mts';

async function main() {
    const task = await client.submitScrapeTask({
        url: 'https://example.com/',
        formats: [Format.MARKDOWN],
    });
    if (!task.id?.trim()) {
        console.error('The submission returned no task ID.');
        process.exitCode = 1;
        return;
    }
    console.log(task.id);
}
main().catch(reportError);
```

```sh
node --env-file=.env submit-async.mts
```

Set `NSTDATA_TASK_ID` in `.env` to that saved ID. This separate program checks once and reads content only when ready. If the task is still running, query the same ID later instead of submitting again.

`read-async.mts`

```typescript
import { client, reportError } from './client.mts';

const taskId = process.env.NSTDATA_TASK_ID;
if (!taskId) throw new Error('Set NSTDATA_TASK_ID to the existing task ID.');

async function main(taskId: string) {
    const result = await client.getScrapeTaskResult(taskId);
    if (result.success === false || result.status === 'failed' || result.status === 'expired') {
        console.error('The scrape task failed.');
        process.exitCode = 1;
        return;
    }
    if (result.status === 'processing' || result.status === 'scraping') {
        console.log('The task is still running. Query the same task ID later.');
        return;
    }
    if (result.status !== 'completed' || !result.data) {
        console.error('No completed scrape data was returned.');
        process.exitCode = 1;
        return;
    }
    const markdown = await result.data.getMarkdown();
    if (markdown === undefined) {
        console.error('No Markdown content was returned.');
        process.exitCode = 1;
        return;
    }
    if (result.data.truncated === true) {
        console.error('Warning: service returned truncated content; output is partial.');
    }
    console.log(markdown);
}
main(taskId).catch(reportError);
```

```sh
node --env-file=.env read-async.mts
```

Polling intervals and overall waiting limits are controlled by your application. See [asynchronous pages](docs/guide.md#asynchronous-pages).

### Crawl a website

Start from one URL and set limits on link discovery:

`start-crawl.mts`

```typescript
import { Format } from '@nstdata-ai/crawl';
import { client, reportError } from './client.mts';

async function main() {
    const task = await client.submitCrawlTask({
        url: 'https://example.com/',
        formats: [Format.MARKDOWN],
        maxDepth: 1,
        maxPages: 10,
        onlyMainContent: false,
    });
    if (!task.id?.trim()) {
        console.error('The submission returned no crawl ID.');
        process.exitCode = 1;
        return;
    }
    console.log(task.id);
}
main().catch(reportError);
```

```sh
node --env-file=.env start-crawl.mts
```

`maxPages` is an upper bound, not a promised result count. `example.com` illustrates the API, not a ten-page website. Keeping `onlyMainContent: false` retains navigation that may help discovery.

Set `NSTDATA_CRAWL_ID` in `.env` to the saved crawl ID. This program checks status once, validates each page and retrieves one result batch:

`read-pages.mts`

```typescript
import { client, reportError } from './client.mts';

const crawlId = process.env.NSTDATA_CRAWL_ID;
if (!crawlId) throw new Error('Set NSTDATA_CRAWL_ID to the existing crawl ID.');
const afterCursor = process.env.NSTDATA_AFTER_CURSOR || undefined;

async function main(crawlId: string) {
    const status = await client.getCrawlStatus(crawlId);
    if (status.status === 'failed' || status.status === 'expired') {
        console.error('The crawl task failed.');
        process.exitCode = 1;
        return;
    }
    if (status.status === 'processing' || status.status === 'scraping') {
        console.log('The crawl is still running. Check the same ID later.');
        return;
    }
    if (status.status !== 'completed') {
        console.error('No completed crawl status was returned.');
        process.exitCode = 1;
        return;
    }
    const pages = await client.listCrawlPages(crawlId, { afterCursor, limit: 20 });
    if (pages.nextCursor && pages.nextCursor === afterCursor) {
        console.error('The pagination cursor did not advance. Keep the current state.');
        process.exitCode = 1;
        return;
    }
    if (!afterCursor && Math.max(pages.total ?? 0, status.completed ?? status.total ?? 0) > 0
        && !pages.data?.length && !pages.nextCursor) {
        console.error('No pages were returned for a nonempty completed crawl.');
        process.exitCode = 1;
        return;
    }
    for (const page of pages.data ?? []) {
        if (page.success === false || page.status !== 'completed' || !page.data) {
            console.error('A page has no successful completed result.');
            process.exitCode = 1;
            return;
        }
        const markdown = await page.data.getMarkdown();
        if (markdown === undefined) {
            console.error('A page has no Markdown content.');
            process.exitCode = 1;
            return;
        }
        if (page.data.truncated === true) {
            console.error('Warning: service returned truncated content; output is partial.');
        }
        console.log(page.url ?? '(page URL unavailable)', markdown);
    }
    console.error(JSON.stringify({ crawlId, afterCursor: pages.nextCursor ?? null }));
}
main(crawlId).catch(reportError);
```

```sh
node --env-file=.env read-pages.mts
```

A completed crawl can contain unsuccessful pages. The final stderr line preserves the recovery state: use a returned string cursor as `NSTDATA_AFTER_CURSOR` for the next run; `null` means stop. Preserve IDs and cursors if a read fails. Re-reading a partly consumed batch can repeat output, so deduplicate saved pages by URL or task ID. Do not combine `afterCursor` and `beforeCursor`. `limit` controls one result batch, not `maxPages`. See [site crawling](docs/guide.md#site-crawling).

### Render JavaScript and run page actions

Use `jsRender` when a page needs JavaScript execution or interactions before extraction. Choose selectors and actions that match your target:

`render.mts`

```typescript
import { ActionBuilder, Format } from '@nstdata-ai/crawl';
import { client, reportError } from './client.mts';

async function main() {
    const result = await client.submitScrapeTaskSync({
        url: 'https://example.com/',
        formats: [Format.MARKDOWN],
        jsRender: {
            waitForSelector: 'h1',
            actions: [ActionBuilder.scrollY(400), ActionBuilder.wait(1000)],
        },
    });
    if (result.success === false || result.status !== 'completed' || !result.data) {
        console.error('No successful completed scrape was returned.');
        process.exitCode = 1;
        return;
    }
    const markdown = await result.data.getMarkdown();
    if (markdown === undefined) {
        console.error('No Markdown content was returned.');
        process.exitCode = 1;
        return;
    }
    if (result.data.truncated === true) {
        console.error('Warning: service returned truncated content; output is partial.');
    }
    console.log(markdown);
}
main().catch(reportError);
```

```sh
node --env-file=.env render.mts
```

Actions execute in the Crawl service. `ActionBuilder` supports clicks, input, waits, scrolling, JavaScript and screenshots. Constructing actions does not submit a task. See [JavaScript rendering](docs/guide.md#javascript-rendering).

## Request configuration

Customize scraping through the request object:

| Option | Purpose |
| --- | --- |
| onlyMainContent | Focus extraction on the main page content |
| targetSelector | Target content using a CSS selector |
| removeSelectors | Remove matching elements |
| includeTags / excludeTags | Configure HTML tag inclusion and exclusion |
| headers | Supply headers for the target request |
| cookies | Supply cookies for the target page |
| proxy.country | Request a proxy country |
| mobile | Configure mobile mode |
| timeout | Set the service-side task timeout |
| jsRender | Configure JavaScript rendering and page actions |

Site crawls also accept `maxPages`, `maxDepth`, `includeUrls`, `excludeUrls`, and `ignoreQuery`. `timeout` is service-side integer milliseconds (1,000–60,000); `jsRender.waitFor` is 1,000–30,000 milliseconds. Defaults and URL-filter syntax are service-defined. See [request fields](docs/guide.md#request-fields).

### Client and request controls

Configure client defaults with `new NstDataClient(token, { timeoutMs: 120_000 })`. Per-call controls also apply to content getters. This example reads an existing task with a local deadline and a 1 MiB response limit:

`controls.mts`

```typescript
import { client, reportError } from './client.mts';

const taskId = process.env.NSTDATA_TASK_ID;
if (!taskId) throw new Error('Set NSTDATA_TASK_ID to the existing task ID.');

async function main(taskId: string) {
    const result = await client.getScrapeTaskResult(taskId, {
        signal: AbortSignal.timeout(10000),
        maxResponseBytes: 1048576,
    });
    console.log({
        completed: result.status === 'completed',
        failed: result.success === false
            || result.status === 'failed'
            || result.status === 'expired',
    });
}
main(taskId).catch(reportError);
```

```sh
node --env-file=.env controls.mts
```

| Control | Scope |
| --- | --- |
| Request-body `timeout` | Service-side processing deadline |
| `timeoutMs` | Local deadline covering one HTTP request and response body |
| `signal` | Local cancellation |
| `maxResponseBytes` | Local decoded response byte cap; omitted means no cap |

Local cancellation stops waiting; it does not cancel the remote task. The default client timeout is 120 seconds. Keep existing IDs and review [request controls](docs/guide.md#request-controls-and-errors).

## Results and error handling

Check both the task status and the returned data before using a result.

| Result | Recommended handling |
| --- | --- |
| status === 'completed' with available data | Check that success is not false, then read the requested formats |
| status === 'processing' or 'scraping' | For an asynchronous task, check the same task ID later |
| status === 'failed' or 'expired' | Handle the task failure |
| success === false | Treat the task or page as unsuccessful |
| data is missing | Do not call content getters |
| data.truncated === true | Treat the content as partial |
| A getter returns undefined | Handle the missing output format |

A completed crawl can still contain unsuccessful pages. Validate each page individually.

The SDK exposes API errors through `NstDataApiError`. Use fields such as `statusCode` and `code` for diagnostics, as shown in the Quick Start.

The SDK does not automatically retry requests. If a submission times out, the server may already have accepted it; inspect task history before creating another task.

**Request controls and error handling:** https://github.com/nstdata-ai/crawl-node/blob/main/docs/guide.md#request-controls-and-errors

## Troubleshooting

| Issue | What to check |
| --- | --- |
| Missing API key | Confirm that NSTDATA_API_TOKEN is set and the script loads .env |
| Authentication error | Confirm that the key is valid and has access to the Crawl API |
| Task is still running | Query the existing asynchronous task ID later |
| Markdown or HTML is missing | Confirm that the format was requested and the task returned data |
| Dynamic content is missing | Configure rendering, selectors, or page actions for the target page |
| Local request times out | Review local request controls and retain any existing task ID |
| Content is truncated | Check data.truncated before treating the content as complete |

[API documentation](https://docs.nstdata.io/docs/crawl/) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
