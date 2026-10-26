# Changelog

## 2.0.0

### Changed

- Change the default origin from `https://api.nstproxy.com` to `https://api.nstdata.io`; retain the public v1 sync/async, result, status and pagination routes from `1.0.1`.
- Add client/per-request deadlines, `AbortSignal`, optional response-byte limits and per-client `fetch` injection. The default deadline is 120 seconds per HTTP operation.
- Reject API/storage redirects, including same-origin redirects, and never retry task creation automatically.
- Preserve empty deferred content and propagate request controls to storage reads.
- Reject malformed stored HTML/Markdown UTF-8 with `TypeError` without caching it; preserve valid Unicode, BOM and raw storage bytes.
- Decode inline Base64 PDF/screenshots and UTF-8 raw text through the existing Buffer getters; prefer present inline content, including empty content, over references.
- Preserve optional content `truncated` and expose the service-provided task `id` in result types. Reject malformed inline binary/raw content and truncation flags without including response values in errors.
- Expose `NstDataApiError` HTTP/API codes without raw response bodies; preserve timeout and transport error types, including interrupted bodies.
- Reject malformed UTF-8 JSON, nonfinite envelope codes, API payload containers, task content and page collections with `NstDataApiError`; validate text, reference, link and known metadata types before consumption, preserving unknown metadata fields. Normalize null content references, links and metadata containers as absent.
- Require explicit `formats` in submission types, matching runtime validation; declare supported Node.js versions in package metadata.
- Replace site-specific action/filter demonstrations with three basic workflows and explicit polling/page/response limits; require completed crawl pages before printing content. Add request/result regressions and installed-package checks.

### Compatibility

- Keep the package name, public exports, existing method names and single-token constructor usage. Optional request controls extend those signatures.
- Require Node.js 22.18+ in the 22.x line, or Node.js 24. Earlier runtimes are outside the supported range.
- Change the default origin from `api.nstproxy.com` to `api.nstdata.io`; request paths and `x-api-key` authentication remain unchanged from `1.0.1`. Overriding `baseURL` changes the request base, retaining an optional path prefix before each public route suffix.
- Make `formats` required in submission types; runtime validation continues to require at least one format, as in `1.0.1`.
- Apply the default 120-second local deadline, reject redirects and malformed payloads, and expose structured SDK errors instead of raw response-body excerpts. Task failures remain result fields; local cancellation does not cancel a remote task.
- Keep PDF/screenshot/raw-data getters returning `Buffer | undefined`, with present inline values now consumed before references.
