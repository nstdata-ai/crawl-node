# Crawl SDK 使用指南

[快速开始](../README_zh.md) · [English](guide.md)

[异步单页](#异步单页) · [整站抓取](#整站抓取) · [JavaScript 渲染](#javascript-渲染) · [内容格式](#内容格式) · [参数与方法参考](#参数与方法参考)

## 准备示例

按 [README](../README_zh.md#安装)安装 SDK，复用快速开始的本地 `.env` 文件，再将下面的共享客户端保存为 `client.mts`。后续程序保存在同一应用目录，用 `node --env-file=.env 文件名.mts` 运行，无需 TypeScript runner，也不需要修改应用的模块类型。

提交任务的示例会调用真实服务并可能消耗额度，请使用获准抓取的目标。`example.com` 仅用于单页演示，不能演示实际抓取十页的效果。

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

共享错误处理只输出 API 状态／业务码或固定的本地失败类别，不输出可能包含私有数据的 API 消息、响应正文或自定义取消原因。

## 异步单页

### 提交一次任务

以下程序创建一个单页任务并输出 ID。保存该 ID 后再查询；提交结果不确定时，不应自动重复创建。

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

### 读取已有任务

在 `.env` 中将保存的 ID 设为 `NSTDATA_TASK_ID`。程序只查询一次，仅在任务完成后读取 Markdown；仍在运行时，稍后查询同一个 ID，不要重新提交。

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

## 整站抓取

### 创建有界任务

整站任务从入口 URL 发现链接。`maxPages` 是页面数量上限，不保证实际收集数量，也不是传入 URL 列表的批量队列。需要保留导航链接用于发现页面时，使用 `onlyMainContent: false`。

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

### 读取整站页面

在 `.env` 中将保存的整站 ID 设为 `NSTDATA_CRAWL_ID`。程序先查询一次状态，再读取一批结果；仅在 `completed` 后读取。整站完成不代表每一页成功，因此仍逐行检查页面结果。

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

最后一行 stderr 输出恢复状态。若 `afterCursor` 为字符串，将其原值保存为 `NSTDATA_AFTER_CURSOR`，再运行同一程序读取下一批；`null` 表示没有返回后续游标，此时停止，不要重新从首页读取。读取失败时保留当前 ID 和游标；重读部分已消费的批次可能重复输出，保存结果时可按 URL 或任务 ID 去重。

每次只使用一个分页方向：`nextCursor` → `afterCursor`，或 `prevCursor` → `beforeCursor`。`limit` 控制单批结果大小，不改变整站的 `maxPages`。

自动轮询的有界工作流见仓库中的[完整示例](https://github.com/nstdata-ai/crawl-node/blob/main/example.ts)。`exampleAsyncPolling(client, signal, state)` 和 `exampleCrawl(client, signal, state)` 会将已接受的任务 ID 及已消费批次的游标写回传入的状态对象，使用同一对象可恢复读取；`afterCursor: null` 标记分页已结束，避免再次从头读取。它们最多查询 20 次状态、读取 100 批页面，默认总期限两分钟；取消本地等待不等于取消远端任务。

## JavaScript 渲染

`jsRender` 可在提取前等待动态内容并执行浏览器动作。`ActionBuilder` 用于构造动作对象，构造本身不发送请求。以下示例等待标题、滚动并暂停后读取 Markdown。

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

按目标页面调整选择器和等待。其他动作包括 `click`、`fill`、`wait`、`waitSelector`、`scrollX`、`scrollY`、`scrollTo`、`executeJs`、`screenshot` 和 `waitForRequest`；网络等待模式由服务解释。

## 内容格式

通过 `formats` 请求格式，再从成功结果的 `data` 读取。以下程序提交一个任务，将 HTML 和 PDF 保存到应用目录的新文件，不覆盖已有文件。

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

| 格式 | 读取方式 | 返回结果 |
|---|---|---|
| `Format.MARKDOWN` | `await data.getMarkdown()` | `string` 或 `undefined` |
| `Format.HTML` | `await data.getHtml()` | `string` 或 `undefined` |
| `Format.LINKS` | `data.links` | `string[]` 或 `undefined` |
| `Format.PDF` | `await data.getPdf()` | `Buffer` 或 `undefined` |
| `Format.SCREENSHOT` | `await data.getScreenshot()` | `Buffer` 或 `undefined` |
| `Format.RAW_DATA` | `await data.getRawData()` | `Buffer` 或 `undefined` |

getter 优先使用内联内容，否则下载对应的不透明引用；不要解码引用或自行拼接存储 URL。成功读取会缓存，包括空内容；失败不缓存。空字符串或空 Buffer 是有效结果，`undefined` 表示缺失。原始数据是字节，不是结构化 JSON 提取。

`metadata` 提供可用的标题、描述、语言、canonical URL、OpenGraph 图片和目标 HTTP 状态。`truncated: true` 表示服务截断；标记缺失不证明内容完整。响应正文和页面列表的可选 `data` 可以是 `null` 或缺失，读取前需检查结果。

## 请求控制与错误

以下程序只读取一次已有任务，设置十秒本地期限和 1 MiB 响应上限，不创建任务。

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

本地期限或 `AbortSignal` 只停止等待，不取消远端任务；保留已有 ID。请求不会自动重试。同步结果即使带 ID，也不保证可再次查询。

| 失败表现 | 含义 | 后续处理 |
|---|---|---|
| `NstDataApiError` | HTTP、API 或响应校验失败 | 用 `statusCode` 和 `code` 排查凭据、额度或请求参数 |
| `TimeoutError` / `AbortError` | 本地等待停止 | 恢复已知任务，不自动重复提交 |
| 返回 `failed` / `expired`，或 `success: false` | 远端任务失败 | 在私密环境查看任务错误，不作为成功正文消费 |
| 已完成结果缺少请求内容 | 对应格式缺失或结果不完整 | 核对请求格式和结果字段 |
| 读取 HTML／Markdown 时出现 `TypeError` | 存储 UTF-8 无效或传输失败 | 保留任务并排查，不当作空正文 |

不要记录完整错误或任务错误消息，它们可能包含私有目标内容。上述共享处理将公开输出限制为失败类别和 API 码。

## 参数与方法参考

### 请求字段

同步单页、异步单页和整站都要求 `url` 与非空 `formats`；其余抓取参数为可选项，未设置时由服务决定默认行为。

| 参数 | 类型 | 用途与约束 |
|---|---|---|
| `url` | `string` | 单页地址或整站入口 |
| `formats` | `string[]` | 至少一个输出格式 |
| `onlyMainContent` | `boolean` | 提取主要正文；可能影响保留的内容和可发现链接 |
| `targetSelector` | `string` | 将提取区域限定为 CSS 选择器匹配的区域 |
| `removeSelectors` | `string[]` | 删除匹配的区域，例如广告或弹窗 |
| `includeTags` / `excludeTags` | `string[]` | 按标签包含或移除内容；提取规则由服务解释 |
| `headers` | `Record<string, string>` | 目标请求的自定义 HTTP 头 |
| `cookies` | `CookieDto[]` | Cookie 对象，字段为 `name/value/domain/path/httpOnly/secure` |
| `proxy.country` | `string` | 代理出口国家代码，例如 `us` |
| `mobile` | `boolean` | 请求移动端页面模拟 |
| `timeout` | `number` | 服务端处理期限，整数毫秒 1000–60000；与本地 `timeoutMs` 分开 |
| `jsRender.waitFor` | `number` | 渲染等待时间，整数毫秒 1000–30000 |
| `jsRender.waitForSelector` | `string` | 等待页面选择器 |
| `jsRender.actions` | `ActionDto[]` | 按服务规则执行浏览器动作 |

仅整站额外支持以下参数：

| 参数 | 类型 | 用途 |
|---|---|---|
| `maxPages` | `number` | 抓取页面数量上限 |
| `maxDepth` | `number` | 链接发现深度上限 |
| `includeUrls` / `excludeUrls` | `string[]` | 原生 URL 过滤，SDK 原样透传；不自行转换成正则或 glob |
| `ignoreQuery` | `boolean` | URL 去重时是否忽略查询参数 |

URL 匹配语法与起始深度规则由服务解释，不保证所有入口会发现同样的页面。

### 配置位置

| 位置 | 支持参数 | 默认值或行为 |
|---|---|---|
| `new NstDataClient(token, options?)` | `baseURL`, `timeoutMs`, `fetch` | 官方地址 `https://api.nstdata.io`，使用 `x-api-key`；120000 ms；全局 fetch |
| 方法的最后一个参数 | `signal`, `timeoutMs`, `maxResponseBytes` | 覆盖该次 HTTP 操作；`listCrawlPages` 放在第三个参数 |
| 内容 getter 的参数 | 同上 | 覆盖本次内容读取；否则继承产生结果的请求设置 |

`timeoutMs` 为 1–2147483647 的整数毫秒，覆盖一次 HTTP 请求及正文读取。`maxResponseBytes` 为正安全整数，省略表示不限制响应大小。请求控制示例显式设置 1 MiB。`signal` 停止本地等待，不取消服务端任务。

`baseURL` 接受不含凭据、查询、fragment 的 HTTP(S) 基址，并保留可选路径前缀。API／存储请求拒绝所有跳转且不自动重试；注入的 `fetch` 必须遵守 `redirect: 'manual'` 与 `AbortSignal`。

### 方法

SDK 返回 API 包装内部的 payload；调用方不需要自行读取外层 envelope。

| 方法 | 返回类型 | HTTP 请求 |
|---|---|---|
| `submitScrapeTaskSync(req, controls?)` | `TaskResultResponseDto` | `POST /api/v1/crawl/scrape` |
| `submitScrapeTask(req, controls?)` | `SubmitResponseDto` | `POST /api/v1/crawl/scrape?async=true` |
| `getScrapeTaskResult(id, controls?)` | `TaskResultResponseDto` | `GET /api/v1/crawl/scrape/{id}` |
| `submitCrawlTask(req, controls?)` | `SubmitResponseDto` | `POST /api/v1/crawl` |
| `getCrawlStatus(id, controls?)` | `CrawlStatusResponseDto` | `GET /api/v1/crawl/{id}` |
| `listCrawlPages(id, paging?, controls?)` | `CrawlPageListResponseDto` | `GET /api/v1/crawl/{id}/pages` |
| `readStorage(ref, controls?)` | `ArrayBuffer` | `GET /api/v1/crawl/storage/read?st={ref}` |

所有方法返回 Promise。接口的字段类型也可通过包导出的 TypeScript 类型查询。
