# Nstdata Crawl SDK for Node.js

[English](README.md)

将网页内容转换为 Markdown、HTML、链接、PDF、截图或原始数据，供 Node.js 应用读取。

## 功能与使用入口

| 你要完成的任务 | 使用方式 | 得到什么 |
|---|---|---|
| 抓取一个页面并立即读取正文 | [快速开始](#快速开始) | 已完成结果及正文 getter |
| 提交单页任务，稍后获取结果 | [异步单页](docs/guide_zh.md#异步单页) | 任务 ID、状态及页面内容 |
| 从入口页发现并抓取站内页面 | [整站与分页](docs/guide_zh.md#整站与分页) | 整站进度、逐页结果及游标 |
| 等待 JavaScript 内容、选择区域或设置请求头 | [抓取参数](docs/guide_zh.md#抓取参数) | 可配置的页面抓取请求 |
| 读取多种格式、metadata 或延迟引用 | [内容与返回结果](docs/guide_zh.md#内容与返回结果) | 文本、字节、链接及元数据 |
| 设置超时、取消和排查失败 | [请求控制与错误](docs/guide_zh.md#请求控制与错误) | 有界请求与可区分的失败类型 |

## 安装

支持 Node.js 22（22.18 及以上）和 24。

```sh
npm install @nstdata-ai/crawl@2.0.0
```

从 1.x 升级前，请阅读[不兼容变化](CHANGELOG.md#compatibility)。

## 快速开始

在环境变量 `NSTDATA_API_TOKEN` 中设置 API Key。下例提交一次同步单页任务，成功后输出 Markdown；调用会消耗服务额度。

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

## 继续使用

[完整使用指南](docs/guide_zh.md)包含异步与整站工作流、参数和返回值参考、内容格式及错误处理。SDK 调用现有 Nstdata 服务，无需自行部署抓取服务。

[API 文档](https://docs.nstdata.io/docs/crawl) · [贡献说明](CONTRIBUTING.md) · [安全反馈](SECURITY.md) · [MIT 许可](LICENSE)
