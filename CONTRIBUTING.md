# Contributing

Preserve public imports and method signatures where possible. Record behavioral and compatibility changes in CHANGELOG.md.

## Checks

Use Node.js 22.18+ in the 22.x line, or Node.js 24:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run check:package
```

## Local package installation

Build an installable archive from the checkout:

```sh
npm pack
```

This produces `nstdata-ai-crawl-2.0.0.tgz`. Install it from a separate application directory:

```sh
npm install /path/to/crawl-node/nstdata-ai-crawl-2.0.0.tgz
```

Tests must use synthetic responses or loopback servers. Cover changes at the public request/result boundary, including failure, empty content, cancellation and resource cleanup. Package checks validate installation, imports, types, packaged documentation links and the bilingual quick-start/async/site examples. Workflow fixtures cover success, failed tasks and missing content, including opaque-cursor pagination without resubmission.

Verify API changes against the public backend implementation when available, then the official API documentation. Keep source checks separate from live-service results. Do not add automatic retries for task creation.

Keep English and Chinese examples consistent. Real API examples may consume credits; run them only against authorized targets. Include no credentials or private responses in fixtures or bug reports.

The online `example.ts` contains one synchronous scrape plus exported async and site workflows. `npm run example` submits only the synchronous task. The latter workflows stop after at most 20 status queries; site pagination stops after 100 batches or a repeated cursor. Each HTTP response is capped at 1 MiB. A supplied signal controls cancellation; the default signal has a 120-second deadline. Keep an existing task ID when local waiting stops.
