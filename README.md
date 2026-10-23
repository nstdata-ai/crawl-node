# Nstdata Crawl SDK for Node.js

[中文](README_zh.md)

Retrieve webpages as Markdown, HTML, links, PDF, screenshots or raw data from Node.js applications.

## Choose a workflow

| Your task | Start here | Result |
|---|---|---|
| Retrieve one page now | [Quick start](#quick-start) | Completed result and content getters |
| Submit a page and retrieve it later | [Async scraping](docs/guide.md#async-scraping) | Task ID, status and page content |
| Discover and crawl pages within a site | [Site crawling](docs/guide.md#site-crawling) | Progress, page results and cursors |
| Wait for JavaScript or select content | [Scrape options](docs/guide.md#scrape-options) | Configurable page requests |
| Read formats, metadata or deferred results | [Content and results](docs/guide.md#content-and-results) | Text, bytes, links and metadata |
| Set limits or diagnose failures | [Request controls and errors](docs/guide.md#request-controls-and-errors) | Bounded requests and distinguishable errors |

## Install

Supports Node.js 22 (22.18 or later) and 24.

> Version 2.0.0 is not yet available on npm. For source installation, see [Contributing](CONTRIBUTING.md).

```sh
npm install @nstdata-ai/crawl@2.0.0
```

Upgrading from 1.x? Read the [breaking changes](CHANGELOG.md#compatibility).

## Quick start

Set your API key in `NSTDATA_API_TOKEN`. This example submits one synchronous page task and prints Markdown on success. Requests consume service credits.

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

## Next steps

The [usage guide](docs/guide.md) covers async and site workflows, request and result fields, content formats and errors. The SDK calls the existing Nstdata service; you do not need to deploy a crawler.

[API documentation](https://docs.nstdata.io/docs/crawl) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
