# Nstdata Crawl Node.js SDK

[English](README.md)

提供单页抓取、整站爬取、状态查询、游标分页和延迟正文读取。支持 Markdown、HTML、链接、截图、PDF 和原始数据。

## 安装

需要 Node.js 22 系列的 22.18+ 或 Node.js 24。当前分支已准备 `2.0.0`，尚未发布。发布后使用：

```sh
npm install @nstdata-ai/crawl@2.0.0
```

发布前的本地安装见[贡献说明](CONTRIBUTING.md)。从 `1.0.1` 升级会改变默认 API 域名、请求限制和错误行为，请先阅读 [CHANGELOG.md](CHANGELOG.md)。

## 快速开始

在环境中设置 `NSTDATA_API_TOKEN`。运行此例会创建一个抓取任务，可能消耗额度。

```typescript
import { NstDataClient, Format } from '@nstdata-ai/crawl';

const TOKEN = process.env.NSTDATA_API_TOKEN;

async function main() {
    if (!TOKEN?.trim()) throw new Error('请先在本机设置 NSTDATA_API_TOKEN');
    const client = new NstDataClient(TOKEN);
    
    const res = await client.submitScrapeTaskSync({
        url: "https://example.com/",
        formats: [Format.MARKDOWN],
        timeout: 60000,
    });
    
    if (res.success === false || res.status === 'failed' || res.status === 'expired') {
        throw new Error('抓取任务失败');
    }
    if (res.status !== 'completed' || !res.data) throw new Error('未返回已完成的抓取数据');
    const md = await res.data.getMarkdown();
    if (md === undefined) throw new Error('未返回 Markdown 内容');
    console.log(md);
}

main().catch(() => {
    console.error('抓取失败，请检查任务状态和本地配置。');
    process.exitCode = 1;
});
```

## API

默认地址为 `https://api.nstdata.io`，鉴权使用 `x-api-key`。

| 方法 | 请求 |
|---|---|
| `submitScrapeTaskSync` | `POST /api/v1/crawl/scrape` |
| `submitScrapeTask` | `POST /api/v1/crawl/scrape?async=true` |
| `getScrapeTaskResult` | `GET /api/v1/crawl/scrape/{taskId}` |
| `submitCrawlTask` | `POST /api/v1/crawl` |
| `getCrawlStatus` | `GET /api/v1/crawl/{crawlId}` |
| `listCrawlPages` | `GET /api/v1/crawl/{crawlId}/pages` |
| `readStorage` | `GET /api/v1/crawl/storage/read?st={ref}` |

异步提交后先保存 ID，再查询结果；同步完成的结果直接消费。读取正文前检查 `failed`、`expired` 和 `success: false`。

任务结果保留服务实际返回的 `id`。同步结果带有 ID，不代表其正文一定可以再次查询。

抓取选项包括 cookies、headers、代理国家、选择器、JavaScript actions、移动端和主内容提取；整站请求还支持页数、深度及 URL 过滤。原生过滤条件和 action URL 模式原样透传，匹配语义由服务端决定。`rawData` 为二进制数据，不代表结构化 JSON 提取。

## 请求控制

```typescript
const client = new NstDataClient(token, {
    baseURL: 'https://api.nstdata.io', // 官方域名，也是默认值。
    timeoutMs: 120000,
});
const controller = new AbortController();
const result = await client.getScrapeTaskResult('task-id', {
    signal: controller.signal,
    timeoutMs: 30000,
});
const markdown = await result.data?.getMarkdown({ timeoutMs: 15000 });
```

- `timeoutMs`：整数 1–2147483647，默认 120000 毫秒，覆盖每次 HTTP 操作及响应体读取；DTO 的 `timeout` 是独立的服务端设置。
- `signal`：停止本地等待，不取消远端任务。
- `maxResponseBytes`：可选正安全整数，限制每个 API／存储响应；省略时不限制正文大小。超限抛出 `NstDataApiError`。
- 请求控制位于方法最后一个参数；`listCrawlPages` 的控制参数在分页选项之后，为第三个参数。

延迟 getter 继承请求控制，可在单次读取时覆盖；成功读取会缓存，包括空文本。Markdown／HTML 返回字符串，PDF／截图／原始数据返回 `Buffer`；缺失内容为 `undefined`，与空结果不同。

`getHtml`／`getMarkdown` 遇到无效 UTF-8 引用正文时抛出 `TypeError`，不缓存解码失败的内容；`readStorage` 和二进制 getter 保留原字节。

内联 PDF／截图按 Base64 解码，内联原始文本按 UTF-8 转为字节。内联内容存在时优先使用，包括空内容；否则读取并缓存引用字节。`data.truncated` 保留服务端截断标记；未返回该标记不代表内容一定完整。

API 和存储请求拒绝所有重定向，包括同源跳转；请求不自动重试。提交结果不确定时，使用已知 ID 恢复，避免重复创建任务。

`baseURL` 接受不含凭据、查询或 fragment 的 HTTP(S) 基址；可选路径前缀会保留在公开路由后缀之前。

`ClientOptions.fetch` 可注入独立传输实现，必须遵守 `redirect: 'manual'` 和 `AbortSignal`。

## 错误处理

`NstDataApiError` 提供可选 HTTP `statusCode` 和 API 业务码 `code`；任务失败保留在结果字段中。超时、取消和传输错误保留自身类型，正文传输中断不会误报为 JSON 语法错误。

无效 UTF-8 JSON、非有限 envelope code、API 数据容器、任务内容容器或页面集合格式错误时，抛出 `NstDataApiError`。不因未知字段拒绝响应；任务失败和缺失内容仍通过结果字段表达。

无效的内联文本、存储引用、链接、metadata、Base64、原始数据和截断标记也抛出 `NstDataApiError`。正文、引用、链接及 metadata 容器为 `null` 时按缺失处理；空文本和空数组仍保留。未知 metadata 字段原样保留。

SDK 错误不包含 HTTP 正文或 JSON 解析片段，业务消息中的当前 Token 会被脱敏。任务错误及网页内容仍可能包含敏感信息；凭据不要写入源码，避免记录完整响应。

[贡献说明](CONTRIBUTING.md) · [API 文档](https://docs.nstdata.io/docs/crawl) · [MIT 许可](LICENSE)
