# Nstdata Crawl SDK for Node.js

[中文](README_zh.md)

Single-page scraping and site crawling with status queries, cursor pagination and deferred content downloads. Supports Markdown, HTML, links, screenshots, PDF and raw data.

## Install

Supported runtimes: Node.js 22 (22.18 or later) and 24.

> Version 2.0.0 is not yet available on npm. For source installation, see [Contributing](CONTRIBUTING.md).

```sh
npm install @nstdata-ai/crawl@2.0.0
```

Upgrading from 1.x? Review the [breaking changes](CHANGELOG.md#compatibility).

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

A synchronous result ID does not guarantee that the result can be queried again.

Scrape options include cookies, headers, proxy country, selectors, JavaScript actions, mobile emulation and main-content extraction. Site requests also accept page/depth and URL filters. Native filters and action URL patterns are passed unchanged; matching semantics are determined by the service. `rawData` is binary data, not a structured-JSON extraction guarantee.

## Request controls

The second constructor argument accepts `baseURL`, `timeoutMs` and `fetch`. Per-request controls are the final method argument:

- `timeoutMs`: integer 1–2147483647, default 120000 milliseconds per HTTP operation, including body reads. DTO `timeout` is a separate server-side setting.
- `signal`: aborts local waiting; it does not cancel a remote task.
- `maxResponseBytes`: optional positive safe integer limiting each API/storage response. Omitted means no body-size cap. A limit failure throws `NstDataApiError`.

For `listCrawlPages`, controls follow pagination options as the third argument.

API and storage redirects, including same-origin redirects, are rejected. Requests are not retried automatically. After an uncertain submission, recover by a known task ID instead of creating another task.

`baseURL` accepts an HTTP(S) base without credentials, query or fragment. An optional path prefix is retained before the public route suffix.

`ClientOptions.fetch` accepts a per-client fetch implementation. Custom transports must honor `redirect: 'manual'` and `AbortSignal`.

## Content

Deferred getters inherit request controls, accept per-read overrides and cache successful reads, including empty text. Markdown/HTML return strings; PDF/screenshots/raw data return `Buffer`. Missing content is `undefined`.

`getHtml`/`getMarkdown` reject malformed UTF-8 references with `TypeError` without caching them; `readStorage` and binary getters preserve bytes.

Inline PDF/screenshots are decoded from Base64; inline raw text is encoded as UTF-8 bytes. Present inline content, including empty content, takes precedence over its reference. Otherwise the getter reads and caches the referenced bytes. `data.truncated` preserves the service's truncation flag; an absent flag does not prove the content is complete.

## Errors

`NstDataApiError` exposes optional HTTP `statusCode` and API-envelope `code`. Task failures remain result fields. Timeout, cancellation and transport errors retain their own types; interrupted bodies are not reported as JSON syntax errors.

Invalid API responses throw `NstDataApiError`, including malformed JSON/UTF-8, invalid envelope codes and incorrectly typed content. Null content, references, links and metadata containers are treated as absent; empty strings and arrays are preserved. Unknown metadata fields are retained.

HTTP bodies and JSON parser excerpts are omitted from SDK errors; the configured token is redacted from envelope messages. Task error text and website content can still contain sensitive data. Keep credentials out of source and avoid logging complete responses.

[Contributing](CONTRIBUTING.md) · [API documentation](https://docs.nstdata.io/docs/crawl) · [MIT license](LICENSE)
