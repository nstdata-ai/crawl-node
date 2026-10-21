import {
    ScrapeRequestDto,
    CrawlRequestDto,
    SubmitResponseDto,
    TaskResultResponseDto,
    CrawlStatusResponseDto,
    CrawlPageListResponseDto,
    ScrapeDataDto,
    ListCrawlPagesOptions,
    ClientOptions,
    RequestOptions,
} from './models';

// Built-in API endpoint.
const BASE_URL = 'https://api.nstdata.io';

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** HTTP/envelope errors; task failures remain in the typed task result. */
export class NstDataApiError extends Error {
    readonly statusCode?: number;
    readonly code?: number;

    constructor(message: string, options: { statusCode?: number; code?: number } = {}) {
        super(message);
        this.name = 'NstDataApiError';
        this.statusCode = options.statusCode;
        this.code = options.code;
    }
}

export class NstDataClient {
    private token: string;
    private baseUrl: string;
    private timeoutMs: number;
    private fetchOverride?: typeof globalThis.fetch;

    constructor(token: string, options: ClientOptions = {}) {
        if (typeof token !== 'string' || !token.trim()) {
            throw new Error('API token is required');
        }
        this.token = token;
        if (options.fetch !== undefined && typeof options.fetch !== 'function') {
            throw new Error('fetch must be a function');
        }
        this.fetchOverride = options.fetch;
        const url = new URL(options.baseURL ?? BASE_URL);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
            throw new Error('baseURL must be an HTTP(S) URL without credentials, query or fragment');
        }
        this.baseUrl = url.toString().replace(/\/+$/, '');
        this.timeoutMs = options.timeoutMs ?? 120000;
        this.validateTimeout(this.timeoutMs);
    }

    private validateTimeout(timeoutMs: number): void {
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
            throw new Error('timeoutMs must be a positive integer up to 2147483647');
        }
    }

    private async fetchResponse<T>(endpoint: string, init: RequestInit, options: RequestOptions,
        read: (res: Response) => Promise<T>): Promise<T> {
        const timeoutMs = options.timeoutMs ?? this.timeoutMs;
        this.validateTimeout(timeoutMs);
        if (options.maxResponseBytes !== undefined && (!Number.isSafeInteger(options.maxResponseBytes) || options.maxResponseBytes <= 0)) {
            throw new Error('maxResponseBytes must be a positive safe integer');
        }
        const controller = new AbortController();
        const abort = () => controller.abort(options.signal?.reason);
        if (options.signal?.aborted) {
            throw options.signal.reason;
        }
        options.signal?.addEventListener('abort', abort, { once: true });
        const timer = setTimeout(() => controller.abort(new DOMException('HTTP request timed out', 'TimeoutError')), timeoutMs);
        try {
            const res = await (this.fetchOverride ?? globalThis.fetch)(`${this.baseUrl}${endpoint}`, {
                ...init, signal: controller.signal, redirect: 'manual',
            });
            return await read(res);
        } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            throw error;
        } finally {
            clearTimeout(timer);
            options.signal?.removeEventListener('abort', abort);
        }
    }

    private getHeaders(hasBody: boolean): Record<string, string> {
        const headers: Record<string, string> = {
            'x-api-key': this.token,
        };
        if (hasBody) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }

    private async readBody(res: Response, maxResponseBytes?: number): Promise<ArrayBuffer> {
        if (maxResponseBytes === undefined) return res.arrayBuffer();
        const tooLarge = () => new NstDataApiError('Response exceeds configured maxResponseBytes', { statusCode: res.status });
        if (Number(res.headers.get('content-length')) > maxResponseBytes) {
            void res.body?.cancel().catch(() => {});
            throw tooLarge();
        }
        if (!res.body) return new ArrayBuffer(0);
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let length = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                length += value.byteLength;
                if (length > maxResponseBytes) {
                    void reader.cancel().catch(() => {});
                    throw tooLarge();
                }
                chunks.push(value);
            }
        } finally {
            reader.releaseLock();
        }
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes.buffer;
    }

    // Public methods return the inner payload; task state is not an HTTP error.
    private async request<T>(method: string, endpoint: string, body: unknown, options: RequestOptions): Promise<T> {
        return this.fetchResponse(endpoint, {
            method,
            headers: this.getHeaders(body !== undefined),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        }, options, async (res) => {
            if (!res.ok) {
                void res.body?.cancel().catch(() => {});
                throw new NstDataApiError(`API error: status=${res.status}`, { statusCode: res.status });
            }

            const bytes = await this.readBody(res, options.maxResponseBytes);
            let payload;
            try {
                payload = JSON.parse(new TextDecoder().decode(bytes));
            } catch {
                // Parser errors can contain snippets of private response bodies.
                throw new NstDataApiError('API error: invalid JSON response', { statusCode: res.status });
            }
            if (!payload || typeof payload !== 'object' || typeof payload.err !== 'boolean' || typeof payload.code !== 'number') {
                throw new NstDataApiError('API error: invalid response envelope', { statusCode: res.status });
            }
            if (payload.err || payload.code !== 200) {
                const message = typeof payload.msg === 'string'
                    ? payload.msg.replaceAll(this.token, '<REDACTED>').slice(0, 1000)
                    : 'Request failed';
                throw new NstDataApiError(`API error: code=${payload.code} msg=${message}`, {
                    statusCode: res.status, code: payload.code,
                });
            }
            if (!isRecord(payload.data)) {
                throw new NstDataApiError('API error: invalid response payload', { statusCode: res.status });
            }
            return payload.data as T;
        });
    }

    async submitScrapeTask(req: ScrapeRequestDto, options: RequestOptions = {}): Promise<SubmitResponseDto> {
        if (!req.url) {
            throw new Error("url is required");
        }
        if (!req.formats || req.formats.length === 0) {
            throw new Error("formats must contain at least one format");
        }
        return this.request('POST', '/api/v1/crawl/scrape?async=true', req, options);
    }

    private normalizeTaskResult(res: TaskResultResponseDto, options: RequestOptions): TaskResultResponseDto {
        if (res.data == null) return res;
        if (!isRecord(res.data)) {
            throw new NstDataApiError('API error: invalid task content');
        }
        const data = res.data;
        for (const field of ['html', 'markdown', 'htmlRef', 'markdownRef', 'pdfRef', 'rawDataRef', 'screenshotRef'] as const) {
            if (data[field] != null && typeof data[field] !== 'string') {
                throw new NstDataApiError('API error: invalid task content');
            }
        }
        if (data.links != null && (!Array.isArray(data.links) || data.links.some(link => typeof link !== 'string'))) {
            throw new NstDataApiError('API error: invalid task content');
        }
        if (data.metadata != null) {
            if (!isRecord(data.metadata)) throw new NstDataApiError('API error: invalid task metadata');
            for (const field of ['canonical', 'description', 'language', 'ogImage', 'title']) {
                const value = data.metadata[field];
                if (value != null && typeof value !== 'string') throw new NstDataApiError('API error: invalid task metadata');
            }
            if (data.metadata.statusCode != null && (typeof data.metadata.statusCode !== 'number' || !Number.isFinite(data.metadata.statusCode))) {
                throw new NstDataApiError('API error: invalid task metadata');
            }
        }
        for (const value of [data.pdf, data.screenshot]) {
            if (value == null) continue;
            if (typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
                || value.length % 4 === 1 || (value.includes('=') && value.length % 4 !== 0)) {
                throw new NstDataApiError('API error: invalid task content');
            }
        }
        if ((data.rawData != null && typeof data.rawData !== 'string')
            || (data.truncated != null && typeof data.truncated !== 'boolean')) {
            throw new NstDataApiError('API error: invalid task content');
        }
        res.data = new ScrapeDataDto(data, (ref, readOptions) => this.readStorage(ref, { ...options, ...readOptions }));
        return res;
    }

    async submitScrapeTaskSync(req: ScrapeRequestDto, options: RequestOptions = {}): Promise<TaskResultResponseDto> {
        if (!req.url) {
            throw new Error("url is required");
        }
        if (!req.formats || req.formats.length === 0) {
            throw new Error("formats must contain at least one format");
        }
        const res = await this.request<TaskResultResponseDto>('POST', '/api/v1/crawl/scrape', req, options);
        return this.normalizeTaskResult(res, options);
    }

    async getScrapeTaskResult(taskId: string, options: RequestOptions = {}): Promise<TaskResultResponseDto> {
        const res = await this.request<TaskResultResponseDto>('GET', `/api/v1/crawl/scrape/${encodeURIComponent(taskId)}`, undefined, options);
        return this.normalizeTaskResult(res, options);
    }

    async submitCrawlTask(req: CrawlRequestDto, options: RequestOptions = {}): Promise<SubmitResponseDto> {
        if (!req.url) {
            throw new Error("url is required");
        }
        if (!req.formats || req.formats.length === 0) {
            throw new Error("formats must contain at least one format");
        }
        return this.request('POST', '/api/v1/crawl', req, options);
    }

    async getCrawlStatus(crawlId: string, options: RequestOptions = {}): Promise<CrawlStatusResponseDto> {
        return this.request('GET', `/api/v1/crawl/${encodeURIComponent(crawlId)}`, undefined, options);
    }

    async listCrawlPages(crawlId: string, opts: ListCrawlPagesOptions = {}, options: RequestOptions = {}): Promise<CrawlPageListResponseDto> {
        const query = new URLSearchParams();
        if (opts.afterCursor) query.set('after_cursor', opts.afterCursor);
        if (opts.beforeCursor) query.set('before_cursor', opts.beforeCursor);
        if (opts.limit !== undefined && opts.limit > 0) query.set('limit', String(opts.limit));

        const qs = query.toString();
        const endpoint = `/api/v1/crawl/${encodeURIComponent(crawlId)}/pages${qs ? `?${qs}` : ''}`;
        const res = await this.request<CrawlPageListResponseDto>('GET', endpoint, undefined, options);
        if (res.data != null && (!Array.isArray(res.data) || res.data.some(item =>
            !isRecord(item) || (item.data != null && !isRecord(item.data))))) {
            throw new NstDataApiError('API error: invalid page results');
        }
        if (res.data) {
            for (const item of res.data) {
                this.normalizeTaskResult(item, options);
            }
        }
        return res;
    }

    public async readStorage(st: string, options: RequestOptions = {}): Promise<ArrayBuffer> {
        return this.fetchResponse(`/api/v1/crawl/storage/read?st=${encodeURIComponent(st)}`, {
            headers: this.getHeaders(false),
        }, options, async (res) => {
            if (!res.ok) {
                void res.body?.cancel().catch(() => {});
                throw new NstDataApiError(`readStorage error: status=${res.status}`, { statusCode: res.status });
            }
            return this.readBody(res, options.maxResponseBytes);
        });
    }
}
