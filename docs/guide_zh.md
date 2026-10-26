# Crawl SDK 使用指南

[返回快速开始](../README_zh.md) · [English](guide.md)

[异步单页](#异步单页) · [整站与分页](#整站与分页) · [抓取参数](#抓取参数) · [内容与返回结果](#内容与返回结果) · [请求控制与错误](#请求控制与错误) · [方法速查](#方法速查)

## 选择执行方式

| 方式 | 何时使用 | 调用顺序 |
|---|---|---|
| 同步单页 | 需要在当前调用中获取一个页面 | `submitScrapeTaskSync` → 检查结果 → 读取正文 |
| 异步单页 | 需要保存任务并稍后继续 | `submitScrapeTask` → 保存 ID → `getScrapeTaskResult` |
| 整站 | 需要发现站内链接并抓取多个页面 | `submitCrawlTask` → 保存 ID → `getCrawlStatus` → `listCrawlPages` |

创建任务不会自动重试。提交结果不确定时保留已知 ID；本地超时或取消不代表远端任务取消。同步结果若带 ID，也不保证可再次查询。

## 异步单页

**用途：**提交后取得任务 ID，随后通过状态查询读取完成结果。`processing`／`scraping` 表示仍在运行；`completed` 后检查 `success` 和 `data`，`failed`／`expired` 时停止。

**返回：**提交返回 `SubmitResponseDto`，查询返回 `TaskResultResponseDto`。下例提交一次，先打印 ID，最多查询 20 次；总期限两分钟，每个响应最多 1 MiB。

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

## 整站与分页

**用途：**从 `url` 发现站内页面，用 `maxPages`、`maxDepth` 和 URL 过滤控制范围。它是链接发现任务，不是逐个处理传入 URL 的批量队列；页数上限不保证实际收集数量。

**返回：**状态包含 `total/completed/failed/pending`；页面列表包含 `data`、`nextCursor` 和 `prevCursor`。每行独立检查 `status/success` 后再读取正文，整站完成不等于每页都成功。

下例最多提交一次、查询 20 次、读取 100 批页面；使用实际 `nextCursor` 翻页并拒绝重复游标。示例只配置十页上限，实际数量由链接发现决定。生产使用时将目标替换为获准抓取的站点。

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

分页只传一个方向：将上页的 `nextCursor` 原值传给 `afterCursor`，或将 `prevCursor` 传给 `beforeCursor`。`limit` 是单次列表大小，与整站 `maxPages` 不同。保存 crawl ID 与游标可继续读取，避免重新提交整站任务。

## 抓取参数

同步单页、异步单页和整站都要求 `url` 与非空 `formats`；其余抓取参数为可选项，未设置时由服务决定默认行为。

| 参数 | 类型 | 用途与约束 |
|---|---|---|
| `url` | `string` | 单页地址或整站入口 |
| `formats` | `string[]` | 至少一个输出格式，见下方格式表 |
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

### JavaScript 动作

`ActionBuilder` 返回动作对象，放入 `jsRender.actions`；构造对象本身不会发送请求。

| helper | 用途 |
|---|---|
| `click(selector)` / `fill(selector, text)` | 点击或填写元素 |
| `wait(milliseconds)` / `waitSelector(selector, timeoutMs?)` | 固定等待或等待元素 |
| `scrollX(pixels)` / `scrollY(pixels)` / `scrollTo(selector)` | 滚动页面或滚动到元素 |
| `executeJs(script)` | 在页面执行 JavaScript |
| `screenshot(full?, selector?)` | 构造截图动作；选择整页、元素或视口 |
| `waitForRequest(urlPattern, timeoutMs?)` | 等待匹配的网络请求；模式由服务解释 |

## 内容与返回结果

`TaskResultResponseDto` 的 `status/success/errorCode/errorMessage` 描述任务结果；内容位于 `data: ScrapeDataDto`。整站页面行还包含 `url/taskId`。这些响应字段均可能缺失，应按实际结果检查。

| 返回对象 | 关键字段 | 如何使用 |
|---|---|---|
| `SubmitResponseDto` | `id`, `status`, `cached`, `code` | 保存实际返回的 ID；`cached` 为服务缓存标记，不是正文 |
| `TaskResultResponseDto` | `status`, `success`, `data`, `errorCode`, `errorMessage`, `id`, `code` | 先判断完成／失败，再读取 `data` |
| `CrawlStatusResponseDto` | `status`, `total`, `completed`, `failed`, `pending`, `id`, `code` | 查询整体进度，不含逐页正文 |
| `CrawlPageListResponseDto` | `data`, `nextCursor`, `prevCursor`, `total`, `completed`, `code` | 按实际游标继续；列表中的每一行仍需独立检查 |

### 输出格式

| `formats` 值 / 常量 | 读取方式 | 返回类型 |
|---|---|---|
| `markdown` / `Format.MARKDOWN` | `await data.getMarkdown()` | `string` 或 `undefined` |
| `html` / `Format.HTML` | `await data.getHtml()` | `string` 或 `undefined` |
| `links` / `Format.LINKS` | `data.links` | `string[]` 或 `undefined` |
| `pdf` / `Format.PDF` | `await data.getPdf()` | `Buffer` 或 `undefined` |
| `screenshot` / `Format.SCREENSHOT` | `await data.getScreenshot()` | `Buffer` 或 `undefined` |
| `rawData` / `Format.RAW_DATA` | `await data.getRawData()` | `Buffer` 或 `undefined`，不是结构化 JSON 提取 |

- getter 优先使用内联内容，否则读取相应 `*Ref`。引用是不透明值，不应自行解码、拼接 URL 或打印。
- 空字符串／空数组仍是有效结果；`undefined` 表示缺失。内联 PDF／截图按 Base64 解码，原始文本按 UTF-8 转为字节。
- getter 继承原请求控制，可传入 `RequestOptions` 覆盖；成功读取包括空内容会缓存，读取失败不缓存。
- `metadata` 提供可用的 `title/description/language/canonical/ogImage/statusCode`，并保留未知字段。`truncated: true` 表示服务截断，标记缺失不证明正文完整。
- `getHtml/getMarkdown` 对无效 UTF-8 引用正文抛出 `TypeError`；`readStorage(ref)` 返回原始 `ArrayBuffer`。通常直接用 getter 即可。

## 请求控制与错误

### 配置位置

| 位置 | 支持参数 | 默认值或行为 |
|---|---|---|
| `new NstDataClient(token, options?)` | `baseURL`, `timeoutMs`, `fetch` | 官方地址 `https://api.nstdata.io`，使用 `x-api-key`；120000 ms；全局 fetch |
| 方法的最后一个参数 | `signal`, `timeoutMs`, `maxResponseBytes` | 覆盖该次 HTTP 操作；`listCrawlPages` 放在第三个参数 |
| 内容 getter 的参数 | 同上 | 覆盖本次内容读取；否则继承产生结果的请求设置 |

`timeoutMs` 为 1–2147483647 的整数毫秒，覆盖一次 HTTP 请求及正文读取。`maxResponseBytes` 为正安全整数，省略表示不限制响应大小。前述示例显式设置 1 MiB。`signal` 停止本地等待，不取消服务端任务。

`baseURL` 接受不含凭据、查询、fragment 的 HTTP(S) 基址，并保留可选路径前缀。API／存储请求拒绝所有跳转且不自动重试；注入的 `fetch` 必须遵守 `redirect: 'manual'` 与 `AbortSignal`。

### 如何识别失败

| 表现 | 含义 | 处理方式 |
|---|---|---|
| `NstDataApiError`，带 `statusCode` | 记录 HTTP 状态；业务或响应校验错误也可能携带 | 结合 `code` 和安全错误信息判断，HTTP 200 不等于任务成功 |
| `NstDataApiError`，带 `code` | API 业务错误 | 按业务码排查；不自动重复提交 |
| `NstDataApiError`，无业务码 | 可能为响应格式校验或体积超限 | 检查错误信息及响应限额，不当作任务成功 |
| `TimeoutError` / `AbortError` | 本地期限或标准取消 | 保留任务 ID；自定义 abort reason 将原样抛出 |
| 返回 `failed/expired` 或 `success: false` | 服务端任务失败 | 读取任务错误字段，不消费为成功正文 |
| 完成结果无 `data` 或 getter 为 `undefined` | 对应内容未返回 | 核对请求格式及结果字段；不当作空正文 |

其他传输错误保留原类型；无效配置也可能在发送前抛错。SDK 不在错误中附带 HTTP 正文／JSON 解析片段，业务消息中的当前 Token 会脱敏；任务错误和网页内容仍可能含敏感数据，避免记录完整响应。

## 方法速查

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
