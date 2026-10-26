# Nstdata Crawl SDK for Node.js

[English](README.md)

在 Node.js 应用中获取网页的 Markdown、HTML、链接、PDF、截图或原始数据。

## 安装

需要 Node.js 22 系列的 22.18 及以上版本，或 Node.js 24。

2.0.0 尚未发布到 npm。使用当前源码版本，请按[本地安装步骤](CONTRIBUTING.md#local-package-installation)操作。

从 1.x 升级前，请阅读[不兼容变化](CHANGELOG.md#compatibility)。

## 快速开始

在 [Nstdata 控制台](https://app.nstdata.io/)获取 API Key，保存到本地 `.env` 文件：

```dotenv
NSTDATA_API_TOKEN=your-api-key
```

将以下代码保存为 `quickstart.mts`；它提交一次单页任务并输出 Markdown，服务调用会消耗额度。

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

在已安装 SDK 的应用目录中运行：

```sh
node --env-file=.env quickstart.mts
```

`.mts` 可由支持的 Node.js 版本直接执行，无需 TypeScript runner，也不需要修改应用的模块类型。

## 按任务继续使用

| 你要完成的任务 | 使用指南 |
|---|---|
| 提交单页任务，稍后获取结果 | [异步单页](docs/guide_zh.md#异步单页) |
| 从入口发现并抓取站内页面 | [整站抓取](docs/guide_zh.md#整站抓取) |
| 读取下一页结果或恢复已有整站任务 | [读取整站页面](docs/guide_zh.md#读取整站页面) |
| 等待 JavaScript 或执行浏览器动作 | [JavaScript 渲染](docs/guide_zh.md#javascript-渲染) |
| 读取 HTML、PDF 等输出格式 | [内容格式](docs/guide_zh.md#内容格式) |
| 设置期限、取消等待或排查失败 | [请求控制与错误](docs/guide_zh.md#请求控制与错误) |

SDK 调用现有 Nstdata 服务，无需自行部署抓取服务。

[API 文档](https://docs.nstdata.io/docs/crawl) · [贡献说明](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [MIT 许可](LICENSE)
