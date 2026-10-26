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

Tests must use synthetic responses or loopback servers. Cover changes at the public request/result boundary, including failure, empty content, cancellation and resource cleanup. Package checks validate installation, imports, nullable result types, rendered Markdown and packaged links. They run every bilingual `.mts` example directly with the supported Node.js runtime against isolated fixtures, including failed tasks, missing content, stored results and pagination without resubmission. The Markdown renderer is a development dependency; the SDK has no runtime dependencies.

Verify API changes against the public backend implementation when available, then the official API documentation. Keep source checks separate from live-service results. Do not add automatic retries for task creation.

Keep English and Chinese examples consistent. Real API examples may consume credits; run them only against authorized targets. Include no credentials or private responses in fixtures or bug reports.

The repository's `example.ts` contains one synchronous scrape plus exported async and site workflows. `npm run example` submits only the synchronous task. The other workflows stop after at most 20 status queries; site pagination stops after 100 batches or a repeated cursor. Each HTTP response is capped at 1 MiB, with a default two-minute overall deadline. A supplied signal controls cancellation.

To resume, retain the optional third argument: `{ taskId }` for `exampleAsyncPolling`, or `{ crawlId, afterCursor }` for `exampleCrawl`. The examples update this object only after accepting a task or consuming a complete result batch. A crawl cursor of `null` marks completion; passing that completed state again does not restart reading. Keep state after a failure; retrying a partly consumed batch may repeat output. These functions are repository examples, not SDK exports.

## Publishing to npm

The `Publish npm` workflow is manually dispatched from `main`. Pushes and pull requests only run checks. Publishing requires approval through the `npm-production` GitHub environment.

Repository administrators configure these once:

1. In **Settings → Environments**, create `npm-production`, add required reviewers, and select only the `main` branch under deployment branches and tags. Disable administrator bypass; the workflow refuses to publish while bypass is enabled. If self-review is prevented, choose a reviewer other than the person dispatching the release.
2. In the npm package's **Settings → Trusted publishing**, authorize GitHub Actions with owner `nstdata-ai`, repository `crawl-node`, workflow filename `release.yml`, and environment `npm-production`. Allow `npm publish`; a stage-only publisher cannot run this workflow. Create the binding close to the release: npm requires a first successful publish within two days. No npm token or local CLI login is needed.

For each release:

1. Review the version, changelog and source changes, then merge the approved commit into `main` after CI passes.
2. Open **Actions → Publish npm → Run workflow**, choose `main`, and enter the stable version from `package.json` and the full reviewed commit SHA. The commit must equal the workflow run's commit; the workflow does not bump versions or select another revision.
3. After the checks pass, compare the commit, version and archive SHA256 in the run summary with the intended release. Download the run's package artifact if further inspection is needed, then approve the pending `npm-production` deployment.

The workflow publishes the checked archive using npm trusted publishing and provenance, then checks the registry integrity and installation in a clean directory. It does not create Git tags or GitHub Releases. If publishing or the post-publication check fails, inspect the version on npm before another dispatch: publication may already have succeeded. Published versions cannot be overwritten.

See the [npm trusted publishing requirements](https://docs.npmjs.com/trusted-publishers/) and [GitHub's manual workflow instructions](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). The workflow must exist on the default branch before it can be dispatched.
