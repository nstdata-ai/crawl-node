<p align="center">
  <img src="https://raw.githubusercontent.com/nstdata-ai/nstdata-mcp-server/main/docs/assets/mcp-banner.png" alt="Nstdata — Power AI Agent with Internet Data" width="960">
</p>

<h1 align="center">Nstdata Crawl SDK for Node.js</h1>

<p align="center">在 Node.js 应用中调用 Nstdata Crawl API，获取网页内容。</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@nstdata-ai/crawl"><img src="https://img.shields.io/npm/v/%40nstdata-ai%2Fcrawl?logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@nstdata-ai/crawl"><img src="https://img.shields.io/npm/dm/%40nstdata-ai%2Fcrawl?logo=npm" alt="npm downloads"></a>
  <a href="https://github.com/nstdata-ai/crawl-node/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License"></a>
  <a href="https://github.com/nstdata-ai/crawl-node/stargazers"><img src="https://img.shields.io/github/stars/nstdata-ai/crawl-node?style=social" alt="GitHub stars"></a>
</p>

<p align="center">
  <a href="https://app.nstdata.io/?utm_source=github&amp;utm_medium=social&amp;utm_campaign=crawl-node-sdk&amp;utm_content=readme"><img src="https://img.shields.io/badge/Dashboard-4F46E5?style=for-the-badge&amp;logo=googlechrome&amp;logoColor=white" alt="Dashboard"></a>
  <a href="https://docs.nstdata.io/zh-CN/docs/crawl/?utm_source=github&amp;utm_medium=social&amp;utm_campaign=crawl-node-sdk&amp;utm_content=readme"><img src="https://img.shields.io/badge/Crawl_API_Docs-2563EB?style=for-the-badge&amp;logo=readthedocs&amp;logoColor=white" alt="Crawl API documentation"></a>
  <a href="https://discord.gg/sMsfTzCpe7"><img src="https://img.shields.io/badge/Join_our_Discord-5865F2?style=for-the-badge&amp;logo=discord&amp;logoColor=white" alt="Join our Discord"></a>
  <a href="https://x.com/nstdata"><img src="https://img.shields.io/badge/Follow_on_X-000000?style=for-the-badge&amp;logo=x&amp;logoColor=white" alt="Follow on X"></a>
</p>

[English](README.md) · [简体中文](README_zh.md)

---

在 JavaScript 和 TypeScript 应用中调用 Nstdata Crawl API，抓取单个网页、提交远端异步任务，或按深度和页面数量限制抓取网站，获取 Markdown、HTML、链接、PDF、截图或原始字节。

SDK 从你的应用调用 Nstdata 托管服务，无需 MCP 或单独部署爬虫服务。

[GitHub 仓库](https://github.com/nstdata-ai/crawl-node) · [完整使用指南](docs/guide_zh.md)

## 环境要求

- Node.js **22.x 系列的 22.18 及以上版本**，或 **Node.js 24.x**。
- 一个 [Nstdata API Key](https://app.nstdata.io/) 和可用额度。使用调用 Crawl 服务的同一个 Nstdata API Key。

## 安装

在 Node.js 项目中安装 SDK，当前版本为 2.0.1：

```sh
npm install @nstdata-ai/crawl
```

安装包包含 TypeScript 类型定义，支持 ESM 和 CommonJS。从 1.x 升级时，请先阅读[兼容性说明](CHANGELOG.md#compatibility)。

## 认证

在应用目录创建本地 `.env` 文件：

```dotenv
NSTDATA_API_TOKEN=your-api-key
```

不要将它提交到版本控制。SDK 使用 `x-api-key` 认证，Key 应保存在服务端环境中。下方命令通过 Node 的 `--env-file` 参数显式加载 `.env`。

## 快速开始

将完整程序保存为 `quickstart.mts`。它提交一次单页抓取并输出 Markdown，服务请求会消耗额度。支持的 Node.js 版本可直接运行 `.mts`，无需额外 TypeScript 运行器，也无需修改应用的模块类型。

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

内容 getter 会读取内联正文，或按需下载引用内容。缺失格式返回 `undefined`，空字符串则是有效的空正文。经过正文过滤后，标题可能只存在于 `data.metadata.title` 中。

## 后续示例共用的客户端

将 `client.mts` 保存在同一目录。后面的每个示例都是独立的可运行文件，共用这个客户端和同一个 `.env`。每次运行一个工作流。

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

## 输出格式

可以请求一种或多种格式；确认任务成功完成后再读取：

| 格式 | 读取方式 | 返回类型 | 常见用途 |
| --- | --- | --- | --- |
| `Format.MARKDOWN` | `await data.getMarkdown()` | `string` 或 `undefined` | 文本处理和大模型上下文 |
| `Format.HTML` | `await data.getHtml()` | `string` 或 `undefined` | HTML 解析和内容检查 |
| `Format.LINKS` | `data.links` | `string[]` 或 `undefined` | 收集链接 |
| `Format.PDF` | `await data.getPdf()` | `Buffer` 或 `undefined` | 文档存储 |
| `Format.SCREENSHOT` | `await data.getScreenshot()` | `Buffer` 或 `undefined` | 视觉检查 |
| `Format.RAW_DATA` | `await data.getRawData()` | `Buffer` 或 `undefined` | 原始响应处理 |

原始数据是字节，并不执行结构化 JSON 提取。下面的完整示例同时请求 HTML 和 PDF，并写入新文件；已有同名文件时不会覆盖。

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

## 核心工作流

### 提交异步单页抓取

只提交一次，在查询状态前先保存返回的任务 ID：

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

在 `.env` 中将 `NSTDATA_TASK_ID` 设置为保存的任务 ID。下面的独立程序查询一次，仅在任务完成后读取正文。如果仍在运行，稍后继续查询同一个 ID，不要重新提交。

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

轮询间隔与总等待时间由应用控制。详见[异步单页抓取](docs/guide_zh.md#异步单页)。

### 抓取网站

从一个 URL 开始，并限制链接发现范围：

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

`maxPages` 是上限，不保证返回相同数量的页面。`example.com` 只用于演示接口，并不是一个十页网站。`onlyMainContent: false` 可保留有助于发现链接的导航内容。

在 `.env` 中将 `NSTDATA_CRAWL_ID` 设置为保存的抓取 ID。下面的程序查询一次状态，逐页验证结果并读取一批页面：

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

已完成的网站任务仍可能包含失败页面。stderr 最后一行保存恢复状态：如果返回字符串游标，将其设为 `NSTDATA_AFTER_CURSOR` 后再次运行；`null` 表示停止。读取失败时保留 ID 和游标。重新读取已消费了一部分的批次可能重复输出，保存数据时应按 URL 或任务 ID 去重。不要同时提供 `afterCursor` 和 `beforeCursor`。`limit` 是单批结果数，与 `maxPages` 不同。详见[网站抓取](docs/guide_zh.md#整站抓取)。

### 渲染 JavaScript 与页面交互

页面需要执行 JavaScript 或先完成交互时，使用 `jsRender`，并选择适合目标页面的选择器和操作：

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

操作在 Crawl 服务端执行。`ActionBuilder` 支持点击、输入、等待、滚动、JavaScript 和截图；构造操作对象本身不会提交任务。详见 [JavaScript 渲染](docs/guide_zh.md#javascript-渲染)。

## 请求配置

通过请求对象定制抓取行为：

| 参数 | 用途 |
| --- | --- |
| `onlyMainContent` | 聚焦提取页面正文 |
| `targetSelector` | 使用 CSS 选择器指定提取区域 |
| `removeSelectors` | 删除匹配元素 |
| `includeTags` / `excludeTags` | 设置 HTML 标签的保留与排除规则 |
| `headers` | 目标请求的自定义请求头 |
| `cookies` | 目标页面 Cookie |
| `proxy.country` | 请求代理出口国家 |
| `mobile` | 移动端模拟 |
| `timeout` | 服务端任务超时 |
| `jsRender` | JavaScript 渲染和页面操作 |

网站抓取还支持 `maxPages`、`maxDepth`、`includeUrls`、`excludeUrls` 和 `ignoreQuery`。`timeout` 是服务端整数毫秒，范围为 1,000–60,000；`jsRender.waitFor` 的范围为 1,000–30,000 毫秒。默认值与 URL 过滤语法由服务解释。详见[请求字段](docs/guide_zh.md#请求字段)。

### 客户端与请求控制

可通过 `new NstDataClient(token, { timeoutMs: 120_000 })` 配置客户端默认值。单次调用控制也适用于内容 getter。下面的示例读取一个已有任务，设置本地截止时间和 1 MiB 响应上限：

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

| 控制项 | 范围 |
| --- | --- |
| 请求体 `timeout` | 服务端处理截止时间 |
| `timeoutMs` | 覆盖单个 HTTP 请求及响应体读取的本地截止时间 |
| `signal` | 本地取消 |
| `maxResponseBytes` | 解码后的本地响应字节上限；省略时不限制 |

本地取消只停止等待，不会取消远端任务。客户端默认超时为 120 秒。保留已有 ID，详见[请求控制与错误](docs/guide_zh.md#请求控制与错误)。

## 结果与错误处理

使用结果前，同时检查任务状态和返回数据。

| 结果 | 建议处理 |
| --- | --- |
| `status === 'completed'` 且数据存在 | 确认 `success` 不为 `false` 后读取请求的格式 |
| `status === 'processing'` 或 `'scraping'` | 稍后查询同一个异步任务 ID |
| `status === 'failed'` 或 `'expired'` | 处理任务失败 |
| `success === false` | 将任务或页面视为失败 |
| 缺少 `data` | 不调用内容 getter |
| `data.truncated === true` | 将内容视为部分结果 |
| getter 返回 `undefined` | 处理输出格式缺失 |

已完成的整站任务仍可能包含失败页面，需要逐页验证。SDK 通过 `NstDataApiError` 暴露 API 错误，使用 `statusCode` 和 `code` 定位问题。

SDK 不会自动重试。提交超时时，服务端可能已经接收任务；决定是否重新提交前，请先检查任务历史。详见[请求控制与错误](docs/guide_zh.md#请求控制与错误)。

## 常见问题

| 问题 | 检查项 |
| --- | --- |
| 缺少 API Key | 确认设置了 `NSTDATA_API_TOKEN`，且命令正确加载 `.env` |
| 认证失败 | 检查 Key 是否有效、账号是否可访问 Crawl 服务 |
| 任务仍在运行 | 稍后查询原异步任务 ID |
| 缺少 Markdown 或 HTML | 确认请求了对应格式，且任务返回了数据 |
| 动态内容缺失 | 为实际页面配置渲染、选择器或操作 |
| 本地请求超时 | 检查本地请求控制并保留已有任务 ID |
| 内容被截断 | 使用完整内容前先检查 `data.truncated` |

[API 文档](https://docs.nstdata.io/zh-CN/docs/crawl/) · [贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [MIT 许可证](LICENSE)
