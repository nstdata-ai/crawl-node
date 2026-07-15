# nstdata crawl SDK (Node.js)

[中文版](README_zh.md)

Node.js SDK for nstdata crawl, an advanced web scraping and crawling service.

## Installation

```bash
npm install @nstdata-ai/crawl
```

## Features

- **Basic Scraping:** Get HTML and Markdown synchronously.
- **Screenshots & PDFs:** Take full-page screenshots and export pages as PDFs.
- **Browser Actions:** Orchestrate browser actions like wait for elements, fill forms, click buttons, scroll, and execute JS.
- **Custom Configuration:** Bring your own cookies, headers, and simulate mobile devices.
- **Content Filtering:** Automatically extract high-quality main content, filter out ads and navigational elements.
- **Proxy Support:** Specify proxy type (residential or datacenter) and exit country.
- **Asynchronous Execution & Polling:** Submit time-consuming tasks and poll for results.
- **Batch Crawling:** Traverse entire sites with depth and page limits.

## Quick Start

See [example.ts](./example.ts) for a complete list of usage examples.

```typescript
import { NstDataClient, Format } from '@nstdata-ai/crawl';

// Initialize the client with your API token
const TOKEN = process.env.NSTDATA_API_TOKEN || "YOUR_API_TOKEN";

async function main() {
    const client = new NstDataClient(TOKEN);
    
    // Submit a basic scraping task
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        timeout: 60000,
    });
    
    // Output the resulting markdown
    const md = await res.data?.getMarkdown();
    console.log(md);
}

main().catch(console.error);
```
