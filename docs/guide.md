# Crawl SDK usage guide

[Back to quick start](../README.md) · [中文](guide_zh.md)

[Async scraping](#async-scraping) · [Site crawling](#site-crawling) · [Scrape options](#scrape-options) · [Content and results](#content-and-results) · [Request controls and errors](#request-controls-and-errors) · [Method reference](#method-reference)

## Choose an execution mode

| Mode | Use when | Sequence |
|---|---|---|
| Synchronous page | You need one page in the current call | `submitScrapeTaskSync` → check result → read content |
| Asynchronous page | You need to save and resume a task | `submitScrapeTask` → save ID → `getScrapeTaskResult` |
| Site crawl | You need discovered internal pages | `submitCrawlTask` → save ID → `getCrawlStatus` → `listCrawlPages` |

Creation is never retried automatically. Preserve a known ID after an uncertain submission. Local timeout/cancellation does not cancel the remote task. A synchronous result ID does not guarantee it can be queried again.

## Async scraping

**Purpose:** submit a page, save its task ID and query the result later. `processing`/`scraping` mean running; inspect `success` and `data` after `completed`. Stop on `failed`/`expired`.

**Returns:** submission yields `SubmitResponseDto`; queries yield `TaskResultResponseDto`. This complete example submits once, prints the ID first and makes at most 20 queries, with a two-minute overall deadline and a 1 MiB response cap.

```typescript
import { setTimeout as delay } from 'node:timers/promises';
import { NstDataClient, Format, TaskStatus, TaskResultResponseDto, ScrapeDataDto } from '@nstdata-ai/crawl';

function resultData(res: TaskResultResponseDto): ScrapeDataDto {
    if (res.success === false || res.status === TaskStatus.FAILED || res.status === TaskStatus.EXPIRED) {
        throw new Error('Scrape task failed');
    }
    if (res.status !== TaskStatus.COMPLETED || !res.data) throw new Error('No completed scrape data returned');
    return res.data;
}


async function exampleAsyncPolling(client: NstDataClient, signal = AbortSignal.timeout(120000)) {
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


async function main() {
    const token = process.env.NSTDATA_API_TOKEN;
    if (!token?.trim()) throw new Error('Set NSTDATA_API_TOKEN');
    await exampleAsyncPolling(new NstDataClient(token));
}
main().catch(() => {
    console.error('Workflow stopped; preserve any printed task ID.');
    process.exitCode = 1;
});
```

## Site crawling

**Purpose:** discover internal pages from `url`, bounded by `maxPages`, `maxDepth` and URL filters. This is link discovery, not a batch queue over a supplied URL list; a page cap does not guarantee a collected count.

**Returns:** status exposes `total/completed/failed/pending`. Lists expose `data`, `nextCursor` and `prevCursor`. Check each row's `status/success` before reading content: a finished site task can contain failed pages.

This complete example submits once, makes at most 20 status queries and reads at most 100 batches, using actual cursors and rejecting repeats. Its ten-page cap does not guarantee ten discovered pages. Replace the target with a site you are authorized to crawl.

```typescript
import { setTimeout as delay } from 'node:timers/promises';
import { NstDataClient, Format, TaskStatus, TaskResultResponseDto, ScrapeDataDto } from '@nstdata-ai/crawl';

async function exampleCrawl(client: NstDataClient, signal = AbortSignal.timeout(120000)) {
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
    if (!token?.trim()) throw new Error('Set NSTDATA_API_TOKEN');
    await exampleCrawl(new NstDataClient(token));
}
main().catch(() => {
    console.error('Workflow stopped; preserve any printed task ID.');
    process.exitCode = 1;
});
```

Use one pagination direction: pass the previous `nextCursor` unchanged as `afterCursor`, or `prevCursor` as `beforeCursor`. `limit` sizes a list response; it is separate from the site's `maxPages`. Preserve the crawl ID and cursor to continue without another submission.

## Scrape options

All three modes require `url` and a nonempty `formats`. Other scrape fields are optional; omitted server settings use service defaults.

| Field | Type | Purpose and constraints |
|---|---|---|
| `url` | `string` | Page URL or site entry |
| `formats` | `string[]` | At least one format from the table below |
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

### JavaScript actions

`ActionBuilder` creates objects for `jsRender.actions`; constructing them sends no request.

| Helper | Purpose |
|---|---|
| `click(selector)` / `fill(selector, text)` | Click or fill an element |
| `wait(milliseconds)` / `waitSelector(selector, timeoutMs?)` | Fixed wait or element wait |
| `scrollX(pixels)` / `scrollY(pixels)` / `scrollTo(selector)` | Scroll by pixels or to an element |
| `executeJs(script)` | Execute page JavaScript |
| `screenshot(full?, selector?)` | Build a full-page, element or viewport screenshot action |
| `waitForRequest(urlPattern, timeoutMs?)` | Wait for matching network activity; service interprets the pattern |

## Content and results

`TaskResultResponseDto` exposes `status/success/errorCode/errorMessage`; content is in `data: ScrapeDataDto`. Site rows also expose `url/taskId`. Response fields are optional: inspect what is actually returned.

| Returned object | Key fields | Usage |
|---|---|---|
| `SubmitResponseDto` | `id`, `status`, `cached`, `code` | Preserve the actual ID; `cached` is a service cache flag, not content |
| `TaskResultResponseDto` | `status`, `success`, `data`, `errorCode`, `errorMessage`, `id`, `code` | Check completion/failure before consuming `data` |
| `CrawlStatusResponseDto` | `status`, `total`, `completed`, `failed`, `pending`, `id`, `code` | Aggregate progress, without per-page content |
| `CrawlPageListResponseDto` | `data`, `nextCursor`, `prevCursor`, `total`, `completed`, `code` | Follow actual cursors; check each returned row separately |

### Output formats

| Format / constant | Read with | Result type |
|---|---|---|
| `markdown` / `Format.MARKDOWN` | `await data.getMarkdown()` | `string` or `undefined` |
| `html` / `Format.HTML` | `await data.getHtml()` | `string` or `undefined` |
| `links` / `Format.LINKS` | `data.links` | `string[]` or `undefined` |
| `pdf` / `Format.PDF` | `await data.getPdf()` | `Buffer` or `undefined` |
| `screenshot` / `Format.SCREENSHOT` | `await data.getScreenshot()` | `Buffer` or `undefined` |
| `rawData` / `Format.RAW_DATA` | `await data.getRawData()` | `Buffer` or `undefined`, not schema extraction |

- Getters prefer inline content, otherwise downloading the corresponding `*Ref`. References are opaque; do not decode them, construct URLs or log their values.
- Empty strings/arrays are valid; `undefined` means absent. Inline PDF/screenshots decode Base64; raw text becomes UTF-8 bytes.
- Getters inherit request controls and accept `RequestOptions` overrides. Successful reads, including empty content, are cached; failed reads are not.
- `metadata` exposes available `title/description/language/canonical/ogImage/statusCode` and preserves unknown fields. `truncated: true` signals service truncation; an absent flag does not prove completeness.
- `getHtml/getMarkdown` throw `TypeError` for malformed UTF-8 references. `readStorage(ref)` returns raw `ArrayBuffer`; getters are normally sufficient.

## Request controls and errors

### Where options go

| Location | Options | Defaults or behavior |
|---|---|---|
| `new NstDataClient(token, options?)` | `baseURL`, `timeoutMs`, `fetch` | `https://api.nstdata.io`, `x-api-key` authentication; 120000 ms; global fetch |
| Final method argument | `signal`, `timeoutMs`, `maxResponseBytes` | Per HTTP operation; third argument for `listCrawlPages` |
| Content getter argument | Same controls | Overrides the content read; otherwise inherits the originating request |

`timeoutMs` is an integer 1–2147483647 milliseconds covering one HTTP operation and body read. `maxResponseBytes` is a positive safe integer; omission means no size cap. Examples explicitly cap responses at 1 MiB. A `signal` stops local waiting, not the remote task.

`baseURL` accepts HTTP(S) without credentials, query or fragment, preserving an optional path prefix. API/storage redirects are refused and requests are not automatically retried. Injected `fetch` must honor `redirect: 'manual'` and `AbortSignal`.

### Recognizing failures

| Observation | Meaning | Response |
|---|---|---|
| `NstDataApiError` with `statusCode` | HTTP response status; also present on some API/validation errors | Combine with `code` and the safe message; HTTP200 does not prove task success |
| `NstDataApiError` with `code` | API business error | Investigate the code; do not resubmit automatically |
| `NstDataApiError` without business code | Can be response validation or size limit | Inspect the safe message and configured limit |
| `TimeoutError` / `AbortError` | Local deadline or standard cancellation | Preserve task ID; custom abort reasons are thrown unchanged |
| Returned `failed/expired` or `success: false` | Remote task failure | Inspect task error fields; do not consume as successful content |
| Completed result lacks `data`, or getter yields `undefined` | Requested content absent | Check formats and result fields; do not treat as empty content |

Other transport errors retain their type; invalid configuration can fail before sending. SDK errors omit HTTP bodies/parser excerpts and redact the configured token in envelope messages. Task errors and page content may still be sensitive: avoid logging complete responses.

## Method reference

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
