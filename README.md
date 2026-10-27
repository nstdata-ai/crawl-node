# Nstdata Crawl SDK for Node.js

[中文](README_zh.md)

Retrieve webpages as Markdown, HTML, links, PDF, screenshots or raw data from Node.js applications.

## Install

Requires Node.js 22.18+ in the 22.x line, or Node.js 24.

```sh
npm install @nstdata-ai/crawl
```

Upgrading from 1.x? Read the [breaking changes](CHANGELOG.md#compatibility).

## Quick start

Get an API key from the [Nstdata dashboard](https://app.nstdata.io/). Put it in a local `.env` file:

```dotenv
NSTDATA_API_TOKEN=your-api-key
```

Save the following as `quickstart.mts`. It submits one page task and prints Markdown; service calls consume credits.

```typescript
import { NstDataClient, NstDataApiError, Format } from '@nstdata-ai/crawl';

const token = process.env.NSTDATA_API_TOKEN;
if (!token?.trim()) throw new Error('Set NSTDATA_API_TOKEN in your environment.');
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

Run it from the application directory where the SDK is installed:

```sh
node --env-file=.env quickstart.mts
```

`.mts` runs directly on the supported Node.js versions, without a TypeScript runner or changes to your application's module type.

## Choose a workflow

| Your task | Guide |
|---|---|
| Submit a page and retrieve it later | [Asynchronous pages](docs/guide.md#asynchronous-pages) |
| Discover pages within a site | [Site crawling](docs/guide.md#site-crawling) |
| Read another result page or resume an existing crawl | [Read crawl pages](docs/guide.md#read-crawl-pages) |
| Wait for JavaScript or perform browser actions | [JavaScript rendering](docs/guide.md#javascript-rendering) |
| Read HTML, PDF and other output formats | [Content formats](docs/guide.md#content-formats) |
| Set deadlines, cancel waiting or diagnose failures | [Request controls and errors](docs/guide.md#request-controls-and-errors) |

The SDK calls the existing Nstdata service; no crawler deployment is required.

[API documentation](https://docs.nstdata.io/docs/crawl) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE)
