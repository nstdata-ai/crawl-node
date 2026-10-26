// Preserve an initial BOM while rejecting malformed storage text.
const storageTextDecoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

/** Local HTTP controls; independent of the server-side request DTO timeout. */
export interface RequestOptions {
    signal?: AbortSignal;
    /** Positive milliseconds, including response-body consumption. */
    timeoutMs?: number;
    /** Optional upper bound for each API or storage response body, in bytes. */
    maxResponseBytes?: number;
}

export interface ClientOptions {
    baseURL?: string;
    /** Per-client transport for API/storage; must honor signal and redirect: 'manual'. Defaults to global fetch. */
    fetch?: typeof globalThis.fetch;
    /** Per HTTP operation, including storage reads. Defaults to 120000 ms. */
    timeoutMs?: number;
}

// Supported output formats for ScrapeRequestDto.formats
export enum Format {
    MARKDOWN = 'markdown',
    HTML = 'html',
    LINKS = 'links',
    PDF = 'pdf',
    SCREENSHOT = 'screenshot',
    RAW_DATA = 'rawData'
}

export enum TaskType {
    SCRAPE = 'scrape',
    CRAWL = 'crawl'
}

export enum TaskStatus {
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
    EXPIRED = 'expired',
    /** A crawl session that is still fetching pages. */
    SCRAPING = 'scraping'
}

// Action types for ActionDto in JsRenderDto
export enum ActionType {
    CLICK = 'click',                                          // click an element; requires selector
    WAIT = 'wait',                                            // wait a fixed time; requires milliseconds
    WAIT_SELECTOR = 'waitSelector',                           // wait for a selector; requires selector
    SCROLL_X = 'scrollX',                                     // scroll horizontally by x pixels
    SCROLL_Y = 'scrollY',                                     // scroll vertically by y pixels
    SCROLL_TO = 'scrollTo',                                   // scroll to an element; requires selector
    FILL = 'fill',                                            // fill an input; requires selector and text
    EXECUTE = 'execute',                                      // run JavaScript on the page; requires execute
    SCREENSHOT = 'screenshot',                                // capture screenshot; fullScreenshot / particularScreenshot / viewport
    WAIT_FOR_REQUEST_COMPLETION = 'waitForRequestCompletion'  // wait for a matching network response; requires urlPattern
}

export interface ActionDto {
    type: string;                  // Type of action (e.g., 'click', 'wait', 'fill')
    selector?: string;             // CSS selector for the action target
    waitSelector?: string;         // CSS selector to wait for
    text?: string;                 // Text to type into an input field
    milliseconds?: number;         // Milliseconds to wait
    execute?: string;              // JavaScript code snippet to execute
    fullScreenshot?: boolean;      // Set to true to capture a full-page screenshot
    particularScreenshot?: string; // CSS selector of an element to screenshot
    urlPattern?: string;           // Native network-wait pattern; interpreted by the service
    x?: number;                    // X coordinate for scroll/click
    y?: number;                    // Y coordinate for scroll/click
    key?: string;                  // Keyboard key to press
}

// Factory helpers for ActionDto. Each helper sets type and the fields that
// action requires, so callers don't need to remember which fields pair with
// which type.
export class ActionBuilder {
    /** Click the element matched by selector. */
    static click(selector: string): ActionDto {
        return { type: ActionType.CLICK, selector };
    }

    /** Pause for a fixed time in milliseconds. */
    static wait(milliseconds: number): ActionDto {
        return { type: ActionType.WAIT, milliseconds };
    }

    /** Wait until the element matched by selector is visible. */
    static waitSelector(selector: string, timeoutMs?: number): ActionDto {
        return { type: ActionType.WAIT_SELECTOR, selector, milliseconds: timeoutMs };
    }

    /** Scroll the window horizontally by pixels. */
    static scrollX(pixels: number): ActionDto {
        return { type: ActionType.SCROLL_X, text: String(pixels), x: pixels };
    }

    /** Scroll the window vertically by pixels. */
    static scrollY(pixels: number): ActionDto {
        return { type: ActionType.SCROLL_Y, text: String(pixels), y: pixels };
    }

    /** Scroll to the element matched by selector. */
    static scrollTo(selector: string): ActionDto {
        return { type: ActionType.SCROLL_TO, selector };
    }

    /** Type text into the input matched by selector. */
    static fill(selector: string, text: string): ActionDto {
        return { type: ActionType.FILL, selector, text };
    }

    /** Run a JavaScript snippet on the page. */
    static executeJs(script: string): ActionDto {
        return { type: ActionType.EXECUTE, execute: script };
    }

    /**
     * Capture a screenshot: full page if full=true, the element matched by
     * selector if given, otherwise the current viewport.
     */
    static screenshot(full = false, selector?: string): ActionDto {
        return { type: ActionType.SCREENSHOT, fullScreenshot: full || undefined, particularScreenshot: selector };
    }

    /** Build a network-wait action; the service interprets urlPattern. */
    static waitForRequest(urlPattern: string, timeoutMs?: number): ActionDto {
        return { type: ActionType.WAIT_FOR_REQUEST_COMPLETION, urlPattern, milliseconds: timeoutMs };
    }
}

export interface JsRenderDto {
    actions?: ActionDto[];   // List of browser actions to perform
    waitFor?: number;        // Global wait time in milliseconds
    waitForSelector?: string; // CSS selector to wait for before proceeding
}

export interface CookieDto {
    domain?: string;   // Domain the cookie belongs to
    httpOnly?: boolean; // True if the cookie is HTTP-only
    name?: string;     // Name of the cookie
    path?: string;     // Path for the cookie
    secure?: boolean;  // True if the cookie requires HTTPS
    value?: string;    // Value of the cookie
}

export interface ProxyDto {
    country?: string;                  // Proxy exit country code (e.g., 'us', 'gb')
}

export interface ScrapeRequestDto {
    url: string;                       // The URL to scrape
    cookies?: CookieDto[];             // Optional cookies to include in the request
    proxy?: ProxyDto;                  // Proxy settings, such as exit country
    excludeTags?: string[];            // HTML tags to remove entirely (e.g., ['nav', 'footer'])
    formats: string[];                 // At least one output format (e.g., ['markdown', 'html', 'links'])
    headers?: Record<string, string>;  // Custom HTTP headers
    includeTags?: string[];            // Included HTML tags; extraction behavior is service-defined
    jsRender?: JsRenderDto;            // JavaScript rendering instructions
    mobile?: boolean;                  // Whether to emulate a mobile device
    onlyMainContent?: boolean;         // Automatically extract main article content and remove noise
    removeSelectors?: string[];        // CSS selectors for elements to remove (e.g., ['.ads', '#popup'])
    targetSelector?: string;           // CSS selector to restrict extraction to a specific element
    timeout?: number;                  // Request timeout in milliseconds
}

/**
 * Scrape options plus crawl traversal controls
 * (maxDepth, maxPages, includeUrls, excludeUrls, ignoreQuery).
 */
export interface CrawlRequestDto {
    url: string;                       // The starting URL to crawl
    cookies?: CookieDto[];             // Optional cookies to include in the request
    proxy?: ProxyDto;                  // Proxy settings, such as exit country
    excludeTags?: string[];            // HTML tags to remove entirely
    excludeUrls?: string[];            // Native URL filters passed unchanged to the service
    formats: string[];                 // At least one output format (e.g., ['markdown', 'html'])
    headers?: Record<string, string>;  // Custom HTTP headers
    ignoreQuery?: boolean;             // Whether to ignore URL query parameters for deduplication
    includeTags?: string[];            // Included HTML tags; extraction behavior is service-defined
    includeUrls?: string[];            // Native URL filters passed unchanged to the service
    jsRender?: JsRenderDto;            // JavaScript rendering instructions
    maxDepth?: number;                 // Maximum depth of links to follow
    maxPages?: number;                 // Maximum number of pages to crawl
    mobile?: boolean;                  // Whether to emulate a mobile device
    onlyMainContent?: boolean;         // Automatically extract main article content
    removeSelectors?: string[];        // CSS selectors for elements to remove
    targetSelector?: string;           // CSS selector to restrict extraction
    timeout?: number;                  // Request timeout in milliseconds
}

export interface SubmitResponseDto {
    cached?: boolean; // True if the response was served from cache
    code?: number;    // Service response code
    id?: string;      // Task ID
    status?: string;  // Task status message
}

export interface PageMetadataDto {
    canonical?: string;   // Canonical URL of the page
    description?: string; // Meta description text
    language?: string;    // Document language code
    ogImage?: string;     // OpenGraph preview image URL
    statusCode?: number;  // HTTP response status code
    title?: string;       // Page title
}

export class ScrapeDataDto {
    public links?: string[];         // List of extracted hyperlinks
    public htmlRef?: string; // Opaque storage reference for HTML
    public markdownRef?: string; // Opaque storage reference for Markdown
    public metadata?: PageMetadataDto; // Extracted page metadata and SEO tags
    public pdfRef?: string; // Opaque storage reference for PDF
    public rawDataRef?: string; // Opaque storage reference for raw data
    public screenshotRef?: string; // Opaque storage reference for screenshot
    public truncated?: boolean;      // Whether the service truncated the content

    private _html?: string;            // Raw HTML content
    private _markdown?: string;        // Extracted content formatted as Markdown
    private _pdf?: Buffer;             // Original PDF bytes
    private _rawData?: Buffer;         // Underlying raw response data
    private _screenshot?: Buffer;      // Original screenshot bytes

    private storageReader?: (ref: string, options?: RequestOptions) => Promise<ArrayBuffer>;

    constructor(data: any, storageReader?: (ref: string, options?: RequestOptions) => Promise<ArrayBuffer>) {
        if (!data) return;
        this.links = data.links ?? undefined;
        this.htmlRef = data.htmlRef ?? undefined;
        this.markdownRef = data.markdownRef ?? undefined;
        this.metadata = data.metadata ?? undefined;
        this.pdfRef = data.pdfRef ?? undefined;
        this.rawDataRef = data.rawDataRef ?? undefined;
        this.screenshotRef = data.screenshotRef ?? undefined;
        this.truncated = data.truncated ?? undefined;

        this._html = data.html;
        this._markdown = data.markdown;
        this._pdf = data.pdf == null ? undefined : Buffer.from(data.pdf, 'base64');
        this._rawData = data.rawData == null ? undefined : Buffer.from(data.rawData, 'utf8');
        this._screenshot = data.screenshot == null ? undefined : Buffer.from(data.screenshot, 'base64');
        this.storageReader = storageReader;
    }

    async getHtml(options?: RequestOptions): Promise<string | undefined> {
        if (typeof this._html === 'string') return this._html;
        if (this.htmlRef && this.storageReader) {
            const buf = await this.storageReader(this.htmlRef, options);
            this._html = storageTextDecoder.decode(buf);
            return this._html;
        }
        return undefined;
    }

    async getMarkdown(options?: RequestOptions): Promise<string | undefined> {
        if (typeof this._markdown === 'string') return this._markdown;
        if (this.markdownRef && this.storageReader) {
            const buf = await this.storageReader(this.markdownRef, options);
            this._markdown = storageTextDecoder.decode(buf);
            return this._markdown;
        }
        return undefined;
    }

    async getPdf(options?: RequestOptions): Promise<Buffer | undefined> {
        if (this._pdf) return this._pdf;
        if (this.pdfRef && this.storageReader) {
            const buf = await this.storageReader(this.pdfRef, options);
            this._pdf = Buffer.from(buf);
            return this._pdf;
        }
        return undefined;
    }

    async getRawData(options?: RequestOptions): Promise<Buffer | undefined> {
        if (this._rawData) return this._rawData;
        if (this.rawDataRef && this.storageReader) {
            const buf = await this.storageReader(this.rawDataRef, options);
            this._rawData = Buffer.from(buf);
            return this._rawData;
        }
        return undefined;
    }

    async getScreenshot(options?: RequestOptions): Promise<Buffer | undefined> {
        if (this._screenshot) return this._screenshot;
        if (this.screenshotRef && this.storageReader) {
            const buf = await this.storageReader(this.screenshotRef, options);
            this._screenshot = Buffer.from(buf);
            return this._screenshot;
        }
        return undefined;
    }
}

export interface TaskResultResponseDto {
    code?: number;          // Custom status code
    data?: ScrapeDataDto | null; // Extracted data; null is retained when returned by the service
    errorCode?: string;     // Error code identifier if any
    errorMessage?: string;  // Detailed error message
    id?: string;           // Task ID when supplied by the service; not a queryability guarantee
    status?: string;        // Current status (e.g., 'completed', 'failed')
    success?: boolean;      // True if the task executed successfully
}

/** Aggregate progress of a crawl session. */
export interface CrawlStatusResponseDto {
    code?: number;      // Custom status code
    completed?: number; // Number of completed pages
    failed?: number;    // Number of failed pages
    id?: string;        // Crawl task ID
    pending?: number;   // Number of pending pages
    status?: string;    // Current status message
    total?: number;     // Total number of discovered pages
}

/** One page's normalized result within a crawl session. */
export interface CrawlPageItemResponseDto {
    data?: ScrapeDataDto | null; // Extracted page data, or the service's explicit null
    errorCode?: string;    // Error code if any
    errorMessage?: string; // Detailed error message
    status?: string;       // Status of this page extraction
    success?: boolean;     // True if extraction was successful
    taskId?: string;       // ID of the specific page task
    url?: string;          // URL of the scraped page
}

/** Cursor-paginated list of crawl page results. */
export interface CrawlPageListResponseDto {
    code?: number;                       // Custom status code
    completed?: number;                  // Number of completed pages
    data?: CrawlPageItemResponseDto[] | null; // Page results, or the service's explicit null
    nextCursor?: string;                 // Cursor for fetching the next page of results
    prevCursor?: string;                 // Cursor for fetching the previous page of results
    total?: number;                      // Total number of pages
}

export interface ListCrawlPagesOptions {
    /** Pages forward; take it from the previous response's nextCursor. */
    afterCursor?: string;
    /** Pages backward; take it from the previous response's prevCursor. */
    beforeCursor?: string;
    /** Requested page size; service limits are enforced by the API. */
    limit?: number;
}
