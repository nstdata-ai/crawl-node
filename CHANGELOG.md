# Changelog

## 2.0.0

### Changes

- Use `https://api.nstdata.io` as the default API origin. Public v1 routes and `x-api-key` authentication are unchanged.
- Add client and per-request deadlines, cancellation, response-size limits and per-client `fetch` injection. Deferred content reads inherit a snapshot of the original request controls and accept overrides.
- Expose `NstDataApiError` with HTTP status and API code. Normalize token header values before sending or redacting them; invalid token and base-URL errors omit their input. SDK errors omit response bodies and parser excerpts.
- Validate known response fields, crawl counters and cursors while preserving unknown extensions and future string statuses. Normalize nullable scalar fields as absent; retain explicit `data: null` and reflect it in TypeScript types.
- Reject redirects and invalid task IDs or pagination controls before consuming results. Task creation is never retried automatically.
- Preserve empty inline and deferred content. Decode inline PDF/screenshots as Base64 and raw text as UTF-8 bytes; malformed stored HTML/Markdown is rejected without caching it.
- Reject malformed Unicode in inline raw text instead of inserting replacement characters.
- Provide runnable bilingual examples for single pages, existing tasks, crawl pagination, browser actions and output formats. Complete repository examples retain recovery state and use bounded polling.
- Add manually triggered, approval-gated npm publishing with a fixed reviewed commit, verified package artifact and trusted publishing.

### Compatibility

- Require Node.js 22.18+ in the 22.x line, or Node.js 24.
- Keep the package name, public exports, existing method names and single-token constructor. Optional controls extend the existing signatures.
- Require an explicit nonempty `formats` array in submission types, matching the existing runtime requirement.
- Apply a default 120-second local deadline per HTTP operation and reject redirects, invalid inputs and malformed known response fields. Local cancellation does not cancel a remote task.
- Keep PDF, screenshot and raw-data getters returning `Buffer | undefined`. Present inline content, including empty content, takes precedence over storage references.
