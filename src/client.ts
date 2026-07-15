import {
    ScrapeRequestDto,
    CrawlRequestDto,
    SubmitResponseDto,
    TaskResultResponseDto,
    CrawlStatusResponseDto,
    CrawlPageListResponseDto,
    ScrapeDataDto,
    ListCrawlPagesOptions,
} from './models';

// Built-in API endpoint.
const BASE_URL = 'https://test-api.nstproxy.com';

export class NstDataClient {
    private token: string;
    private baseUrl: string = BASE_URL;

    constructor(token: string) {
        this.token = token;
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

    // Unwraps the {code, err, msg, data} envelope; passes through responses
    // that don't use it.
    private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
        const res = await fetch(`${this.baseUrl}${endpoint}`, {
            method,
            headers: this.getHeaders(body !== undefined),
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`API error: status=${res.status} body=${text}`);
        }

        const payload = await res.json();
        if (payload && typeof payload === 'object' && 'err' in payload && 'code' in payload) {
            if (payload.err || payload.code !== 200) {
                throw new Error(`API error: code=${payload.code} msg=${payload.msg}`);
            }
            return (payload.data ?? {}) as T;
        }
        return payload as T;
    }



    async submitScrapeTask(req: ScrapeRequestDto): Promise<SubmitResponseDto> {
        if (!req.url) {
            throw new Error("url is required");
        }
        if (!req.formats || req.formats.length === 0) {
            throw new Error("formats must contain at least one format");
        }
        return this.request('POST', '/api/v1/crawl/scrape/submit', req);
    }

    async submitScrapeTaskSync(req: ScrapeRequestDto): Promise<TaskResultResponseDto> {
        if (!req.url) {
            throw new Error("url is required");
        }
        if (!req.formats || req.formats.length === 0) {
            throw new Error("formats must contain at least one format");
        }
        const res = await this.request<TaskResultResponseDto>('POST', '/api/v1/crawl/scrape/submit-sync', req);
        if (res.data) {
            res.data = new ScrapeDataDto(res.data, (ref) => this.readStorage(ref));
        }
        return res;
    }

    async getScrapeTaskResult(taskId: string): Promise<TaskResultResponseDto> {
        const res = await this.request<TaskResultResponseDto>('GET', `/api/v1/crawl/scrape/result/${encodeURIComponent(taskId)}`);
        if (res.data) {
            res.data = new ScrapeDataDto(res.data, (ref) => this.readStorage(ref));
        }
        return res;
    }

    async submitCrawlTask(req: CrawlRequestDto): Promise<SubmitResponseDto> {
        if (!req.url) {
            throw new Error("url is required");
        }
        if (!req.formats || req.formats.length === 0) {
            throw new Error("formats must contain at least one format");
        }
        return this.request('POST', '/api/v1/crawl/submit', req);
    }

    async getCrawlStatus(crawlId: string): Promise<CrawlStatusResponseDto> {
        return this.request('GET', `/api/v1/crawl/status/${encodeURIComponent(crawlId)}`);
    }

    async listCrawlPages(crawlId: string, opts: ListCrawlPagesOptions = {}): Promise<CrawlPageListResponseDto> {
        const query = new URLSearchParams();
        if (opts.afterCursor) query.set('after_cursor', opts.afterCursor);
        if (opts.beforeCursor) query.set('before_cursor', opts.beforeCursor);
        if (opts.limit !== undefined && opts.limit > 0) query.set('limit', String(opts.limit));

        const qs = query.toString();
        const endpoint = `/api/v1/crawl/pages/${encodeURIComponent(crawlId)}${qs ? `?${qs}` : ''}`;
        const res = await this.request<CrawlPageListResponseDto>('GET', endpoint);
        if (res.data) {
            for (const item of res.data) {
                if (item.data) {
                    item.data = new ScrapeDataDto(item.data, (ref) => this.readStorage(ref));
                }
            }
        }
        return res;
    }

    public async readStorage(st: string): Promise<ArrayBuffer> {
        const res = await fetch(`${this.baseUrl}/api/v1/crawl/storage/read?st=${encodeURIComponent(st)}`, {
            headers: this.getHeaders(false),
        });
        if (!res.ok) {
            throw new Error(`readStorage error: status=${res.status}`);
        }
        return res.arrayBuffer();
    }


}
