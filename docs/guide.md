# Crawl SDK usage guide

[Quick start](../README.md) · [中文](guide_zh.md)

[Asynchronous pages](#asynchronous-pages) · [Site crawling](#site-crawling) · [JavaScript rendering](#javascript-rendering) · [Content formats](#content-formats) · [Reference](#reference)

## Set up the examples

Install the SDK as described in the [README](../README.md#install), reuse the local `.env` file from the quick start, then save the shared client below as `client.mts`. Save each following program in the same application directory and run it with `node --env-file=.env <filename>.mts`. No TypeScript runner or module-type change is required.

The request examples submit real tasks and can consume credits. Use your own authorized target. `example.com` is a single-page illustration, not a demonstration of a ten-page crawl.

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

The shared error handler prints API status/code or a fixed local failure category. It deliberately omits API messages, response bodies and custom abort reasons, which may contain private data.

## Asynchronous pages

### Submit once

This creates one single-page task and prints its ID. Save that ID before querying. An uncertain submission must not be repeated automatically.

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

### Read an existing task

Add `NSTDATA_TASK_ID` with the saved ID to `.env`. This program queries once and reads Markdown only when the task has completed. If it is still running, query the same ID later; do not submit another task.

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
    console.log(markdown);
}
main(taskId).catch(reportError);
```

```sh
node --env-file=.env read-async.mts
```

## Site crawling

### Start a bounded crawl

A crawl discovers linked pages from one entry URL. `maxPages` is an upper bound, not a requested result count; it is not a batch queue of supplied URLs. Keep `onlyMainContent: false` when navigation links must remain available for discovery.

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

### Read crawl pages

Add `NSTDATA_CRAWL_ID` with the saved crawl ID to `.env`. The following program checks status once, then reads one result batch. Only `completed` allows reading; a completed crawl may still contain failed page results, so each row is checked separately.

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
        console.log(page.url ?? '(page URL unavailable)', markdown);
    }
    console.error(JSON.stringify({ crawlId, afterCursor: pages.nextCursor ?? null }));
}
main(crawlId).catch(reportError);
```

```sh
node --env-file=.env read-pages.mts
```

The final stderr line contains the recovery state. If `afterCursor` is a string, preserve its exact value as `NSTDATA_AFTER_CURSOR` and run the same program to read the next batch. `null` means no next cursor was returned; stop instead of restarting at the first batch. Keep the current ID/cursor if a read fails. Re-reading a partly consumed batch can repeat output, so deduplicate saved pages by URL or task ID.

Use only one direction: `nextCursor` → `afterCursor`, or `prevCursor` → `beforeCursor`. `limit` controls the result-batch size; it does not change the crawl's `maxPages`.

For an automatic bounded workflow, see the repository's [complete example](https://github.com/nstdata-ai/crawl-node/blob/main/example.ts). `exampleAsyncPolling(client, signal, state)` and `exampleCrawl(client, signal, state)` update the supplied state with an accepted task ID and the last consumed cursor. Pass that same state to resume; `afterCursor: null` marks finished pagination and prevents another read. They stop after at most 20 status queries and 100 page batches; their default overall deadline is two minutes. Local cancellation does not cancel a remote task.

## JavaScript rendering

`jsRender` waits for dynamic content and runs browser actions before extraction. `ActionBuilder` creates the corresponding action objects; constructing an action does not send a request. This example waits for a heading, scrolls and pauses before retrieving Markdown.

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
    console.log(markdown);
}
main().catch(reportError);
```

```sh
node --env-file=.env render.mts
```

Select page-specific elements and waits for your target. Available actions include `click`, `fill`, `wait`, `waitSelector`, `scrollX`, `scrollY`, `scrollTo`, `executeJs`, `screenshot` and `waitForRequest`. Network-wait patterns are interpreted by the service.

## Content formats

Request formats through `formats`, then read them from the successful result's `data`. This example saves HTML and PDF from one task to new files in the application directory; it does not overwrite existing files.

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
    console.log('Saved page.html and page.pdf');
}
main().catch(reportError);
```

```sh
node --env-file=.env formats.mts
```

| Format | Read with | Result |
|---|---|---|
| `Format.MARKDOWN` | `await data.getMarkdown()` | `string` or `undefined` |
| `Format.HTML` | `await data.getHtml()` | `string` or `undefined` |
| `Format.LINKS` | `data.links` | `string[]` or `undefined` |
| `Format.PDF` | `await data.getPdf()` | `Buffer` or `undefined` |
| `Format.SCREENSHOT` | `await data.getScreenshot()` | `Buffer` or `undefined` |
| `Format.RAW_DATA` | `await data.getRawData()` | `Buffer` or `undefined` |

Getters prefer inline content; otherwise they download the corresponding opaque reference. Do not decode references or construct storage URLs. Successful reads are cached, including empty content; failed reads are not. Empty strings or buffers are valid, whereas `undefined` means absent. Raw data is bytes, not structured JSON extraction.

Invalid Unicode in inline raw text is rejected rather than replaced during UTF-8 encoding. Referenced raw data retains its original bytes.

`metadata` contains available title, description, language, canonical URL, OpenGraph image and target status code. `truncated: true` indicates service truncation; an absent flag does not prove completeness. Optional response content and list `data` may be `null` or absent, so check the result before reading.

## Request controls and errors

This example reads one existing task with a ten-second local deadline and a 1 MiB response limit. It does not create a task.

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

A local deadline or `AbortSignal` stops waiting, not the remote task. Preserve the existing ID. No request is automatically retried. A synchronous result's ID does not guarantee that it can be queried again.

| Failure | Meaning | Next action |
|---|---|---|
| `NstDataApiError` | HTTP, API or response-validation failure | Use `statusCode` and `code`; check credentials, quota or request fields |
| `TimeoutError` / `AbortError` | Local waiting stopped | Resume the known task; do not automatically resubmit |
| Result `failed` / `expired`, or `success: false` | Remote task failure | Inspect task error fields privately; do not consume as successful content |
| Completed result without requested content | Format absent or result incomplete | Check requested formats and result fields |
| `TypeError` reading HTML/Markdown | Invalid stored UTF-8 or a transport failure | Retain the task and investigate; do not treat it as empty content |

Avoid logging complete errors or task error messages: they can include private target content. The shared handler above limits public output to failure categories and API codes.

## Reference

### Request fields

All three modes require `url` and a nonempty `formats`. Other scrape fields are optional; omitted server settings use service defaults.

| Field | Type | Purpose and constraints |
|---|---|---|
| `url` | `string` | Page URL or site entry |
| `formats` | `string[]` | At least one output format |
| `onlyMainContent` | `boolean` | Extract primary content; may affect retained content and discoverable links |
| `targetSelector` | `string` | Restrict extraction to a CSS-selected area |
| `removeSelectors` | `string[]` | Remove matching areas, such as ads or popups |
| `includeTags` / `excludeTags` | `string[]` | Include/remove HTML tags; service-defined extraction rules |
| `headers` | `Record<string, string>` | Custom target HTTP headers |
| `cookies` | `CookieDto[]` | Cookie fields: `name/value/domain/path/httpOnly/secure` |
| `proxy.country` | `string` | Proxy exit country code, such as `us` |
| `mobile` | `boolean` | Request mobile emulation |
| `timeout` | `number` | Server processing deadline, integer milliseconds 1000–60000; separate from local `timeoutMs` |
| `jsRender.waitFor` | `number` | Rendering wait, integer milliseconds 1000–30000 |
| `jsRender.waitForSelector` | `string` | Wait for a page selector |
| `jsRender.actions` | `ActionDto[]` | Browser actions interpreted by the service |

Additional site-only fields:

| Field | Type | Purpose |
|---|---|---|
| `maxPages` | `number` | Collected-page cap |
| `maxDepth` | `number` | Link-discovery depth cap |
| `includeUrls` / `excludeUrls` | `string[]` | Native URL filters passed unchanged; SDK does not convert them to regex/glob |
| `ignoreQuery` | `boolean` | Ignore query parameters during URL deduplication |

The service interprets filter syntax and starting depth; different entries need not discover the same pages.

### Where options go

| Location | Options | Defaults or behavior |
|---|---|---|
| `new NstDataClient(token, options?)` | `baseURL`, `timeoutMs`, `fetch` | `https://api.nstdata.io`, `x-api-key` authentication; 120000 ms; global fetch |
| Final method argument | `signal`, `timeoutMs`, `maxResponseBytes` | Per HTTP operation; third argument for `listCrawlPages` |
| Content getter argument | Same controls | Overrides the content read; otherwise inherits the originating request |

`timeoutMs` is an integer 1–2147483647 milliseconds covering one HTTP operation and body read. `maxResponseBytes` is a positive safe integer; omission means no size cap. The controls example explicitly caps responses at 1 MiB. A `signal` stops local waiting, not the remote task.

`baseURL` accepts HTTP(S) without credentials, query or fragment, preserving an optional path prefix. API/storage redirects are refused and requests are not automatically retried. Injected `fetch` must honor `redirect: 'manual'` and `AbortSignal`.

### Methods

Methods return the inner API payload; callers do not unwrap the HTTP envelope.

| Method | Return type | HTTP request |
|---|---|---|
| `submitScrapeTaskSync(req, controls?)` | `TaskResultResponseDto` | `POST /api/v1/crawl/scrape` |
| `submitScrapeTask(req, controls?)` | `SubmitResponseDto` | `POST /api/v1/crawl/scrape?async=true` |
| `getScrapeTaskResult(id, controls?)` | `TaskResultResponseDto` | `GET /api/v1/crawl/scrape/{id}` |
| `submitCrawlTask(req, controls?)` | `SubmitResponseDto` | `POST /api/v1/crawl` |
| `getCrawlStatus(id, controls?)` | `CrawlStatusResponseDto` | `GET /api/v1/crawl/{id}` |
| `listCrawlPages(id, paging?, controls?)` | `CrawlPageListResponseDto` | `GET /api/v1/crawl/{id}/pages` |
| `readStorage(ref, controls?)` | `ArrayBuffer` | `GET /api/v1/crawl/storage/read?st={ref}` |

All methods return Promises. Their TypeScript interfaces are exported by the package.
