# Nstdata Crawl SDK for Node.js

[中文](README_zh.md)

Single-page scraping and site crawling with status queries, cursor pagination and deferred content downloads. Supports Markdown, HTML, links, screenshots, PDF and raw data.

## Install

Requires Node.js 22.18+ in the 22.x line, or Node.js 24. Version `2.0.0` is prepared in this branch and has not been published. After publication, install it with:

```sh
npm install @nstdata-ai/crawl@2.0.0
```

For local installation before publication, see [Contributing](CONTRIBUTING.md). Upgrading from `1.0.1` changes the default API origin, request limits and error behavior; review [CHANGELOG.md](CHANGELOG.md).

## Quick start

Set `NSTDATA_API_TOKEN` in your environment. Running this example creates one scrape task and can consume credits.

```typescript
import { NstDataClient, Format } from '@nstdata-ai/crawl';

const TOKEN = process.env.NSTDATA_API_TOKEN;

async function main() {
    if (!TOKEN?.trim()) throw new Error('Set NSTDATA_API_TOKEN locally');
    const client = new NstDataClient(TOKEN);
    
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        timeout: 60000,
    });
    
    if (res.success === false || res.status === 'failed' || res.status === 'expired') {
        throw new Error('Scrape task failed');
    }
    if (res.status !== 'completed' || !res.data) throw new Error('No completed scrape data returned');
    const md = await res.data.getMarkdown();
    if (md === undefined) throw new Error('No Markdown content returned');
    console.log(md);
}

main().catch(() => {
    console.error('Scrape failed; check the task status and local configuration.');
    process.exitCode = 1;
});
```

## API

Requests use `https://api.nstdata.io` and `x-api-key` authentication.

| Method | Request |
|---|---|
| `submitScrapeTaskSync` | `POST /api/v1/crawl/scrape` |
| `submitScrapeTask` | `POST /api/v1/crawl/scrape?async=true` |
| `getScrapeTaskResult` | `GET /api/v1/crawl/scrape/{taskId}` |
| `submitCrawlTask` | `POST /api/v1/crawl` |
| `getCrawlStatus` | `GET /api/v1/crawl/{crawlId}` |
| `listCrawlPages` | `GET /api/v1/crawl/{crawlId}/pages` |
| `readStorage` | `GET /api/v1/crawl/storage/read?st={ref}` |

Async submission returns an ID. Save it before querying; a completed synchronous result should be consumed directly. Treat task `failed`/`expired` or `success: false` as failure before reading content.

Task results retain `id` when supplied by the service. A synchronous result ID alone does not guarantee that its content can be queried again.

Scrape options include cookies, headers, proxy country, selectors, JavaScript actions, mobile emulation and main-content extraction. Site requests also accept page/depth and URL filters. Native filters and action URL patterns are passed unchanged; matching semantics are determined by the service. `rawData` is binary data, not a structured-JSON extraction guarantee.

## Request controls

```typescript
const client = new NstDataClient(token, {
    baseURL: 'https://api.nstdata.io', // Official origin; also the default.
    timeoutMs: 120000,
});
const controller = new AbortController();
const result = await client.getScrapeTaskResult('task-id', {
    signal: controller.signal,
    timeoutMs: 30000,
});
const markdown = await result.data?.getMarkdown({ timeoutMs: 15000 });
```

- `timeoutMs`: integer 1–2147483647, default 120000 milliseconds per HTTP operation, including body reads. DTO `timeout` is a separate server-side setting.
- `signal`: aborts local waiting; it does not cancel a remote task.
- `maxResponseBytes`: optional positive safe integer limiting each API/storage response. Omitted means no body-size cap. A limit failure throws `NstDataApiError`.
- Controls are the final argument; for `listCrawlPages` they follow pagination options as the third argument.

Deferred getters inherit request controls, allow per-read overrides and cache successful reads, including empty text. Markdown/HTML getters return strings; PDF/screenshot/raw-data getters return `Buffer`. Missing content is `undefined`, distinct from an empty result.

Inline PDF/screenshots are decoded from Base64; inline raw text is encoded as UTF-8 bytes. Present inline content, including empty content, takes precedence over its reference. Otherwise the getter reads and caches the referenced bytes. `data.truncated` preserves the service's truncation flag; an absent flag does not prove the content is complete.

API and storage redirects, including same-origin redirects, are rejected. Requests are not retried automatically. After an uncertain submission, recover by a known task ID instead of creating another task.

`baseURL` accepts an HTTP(S) base without credentials, query or fragment. An optional path prefix is retained before the public route suffix.

`ClientOptions.fetch` accepts a per-client fetch implementation. Custom transports must honor `redirect: 'manual'` and `AbortSignal`.

## Errors

`NstDataApiError` exposes optional HTTP `statusCode` and API-envelope `code`. Task failures remain result fields. Timeout, cancellation and transport errors retain their own types; interrupted bodies are not reported as JSON syntax errors.

Malformed API payload containers, task-content containers and page collections throw `NstDataApiError`. Unrecognized fields do not cause rejection; task failures and absent content remain result fields.

Malformed inline text, storage references, links, metadata, Base64, raw data and truncation flags also throw `NstDataApiError`. Null content, references, links and metadata containers are treated as absent; empty text/arrays remain present. Unknown metadata fields are preserved.

HTTP bodies and JSON parser excerpts are omitted from SDK errors; the configured token is redacted from envelope messages. Task error text and website content can still contain sensitive data. Keep credentials out of source and avoid logging complete responses.

[Contributing](CONTRIBUTING.md) · [API documentation](https://docs.nstdata.io/docs/crawl) · [MIT license](LICENSE)
