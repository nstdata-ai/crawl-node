// Supported output formats for ScrapeRequestDto.formats
export enum Format {
    MARKDOWN = 'markdown',
    HTML = 'html',
    LINKS = 'links',
    PDF = 'pdf',
    SCREENSHOT = 'screenshot',
    RAW_DATA = 'rawData'
}

// Proxy types for ScrapeRequestDto.proxy (defaults to residential when unset)
export enum ProxyType {
    RESIDENTIAL = 'residential',
    DATACENTER = 'datacenter'
}

export enum TaskType {
    SCRAPE = 'scrape',
    CRAWL = 'crawl'
}

export enum TaskStatus {
    PROCESSING = 'processing',
    COMPLETED = 'completed',
    FAILED = 'failed',
    /** A crawl session that is still fetching pages. */
    SCRAPING = 'scraping'
}

// Action types for ActionDto in JsRenderDto
export enum ActionType {
    CLICK = 'click',                                          // click an element; requires selector
    WAIT = 'wait',                                            // wait a fixed time; requires milliseconds
    WAIT_SELECTOR = 'waitSelector',                           // wait until element is visible; requires selector
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
    urlPattern?: string;           // URL pattern to wait for (regex support)
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

    /**
     * Wait for a network response whose URL matches urlPattern
     * (supports * wildcard).
     */
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

export interface ScrapeRequestDto {
    url: string;                       // The URL to scrape
    cookies?: CookieDto[];             // Optional cookies to include in the request
    country?: string;                  // Country code for proxy location (e.g., 'us', 'gb')
    excludeTags?: string[];            // HTML tags to remove entirely (e.g., ['nav', 'footer'])
    formats?: string[];                // Desired output formats (e.g., ['markdown', 'html', 'links'])
    headers?: Record<string, string>;  // Custom HTTP headers
    includeTags?: string[];            // Tags to keep. WARNING: strips all other tags (keeping text), which may break markdown
    jsRender?: JsRenderDto;            // JavaScript rendering instructions
    mobile?: boolean;                  // Whether to emulate a mobile device
    onlyMainContent?: boolean;         // Automatically extract main article content and remove noise
    proxy?: string;                    // Proxy type (e.g., 'datacenter', 'residential')
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
    country?: string;                  // Country code for proxy location
    excludeTags?: string[];            // HTML tags to remove entirely
    excludeUrls?: string[];            // Regex patterns to exclude specific URLs from crawling
    formats?: string[];                // Desired output formats (e.g., ['markdown', 'html'])
    headers?: Record<string, string>;  // Custom HTTP headers
    ignoreQuery?: boolean;             // Whether to ignore URL query parameters for deduplication
    includeTags?: string[];            // Tags to keep. WARNING: strips all other tags
    includeUrls?: string[];            // Regex patterns to only crawl matching URLs
    jsRender?: JsRenderDto;            // JavaScript rendering instructions
    maxDepth?: number;                 // Maximum depth of links to follow
    maxPages?: number;                 // Maximum number of pages to crawl
    mobile?: boolean;                  // Whether to emulate a mobile device
    onlyMainContent?: boolean;         // Automatically extract main article content
    proxy?: string;                    // Proxy type
    removeSelectors?: string[];        // CSS selectors for elements to remove
    targetSelector?: string;           // CSS selector to restrict extraction
    timeout?: number;                  // Request timeout in milliseconds
}

export interface SubmitResponseDto {
    cached?: boolean; // True if the response was served from cache
    code?: number;    // HTTP status code
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
    public htmlRef?: string;         // Reference link to fetch the HTML content
    public markdownRef?: string;     // Reference link to fetch the Markdown content
    public metadata?: PageMetadataDto; // Extracted page metadata and SEO tags
    public pdfRef?: string;          // Reference link to fetch the PDF
    public rawDataRef?: string;      // Reference link to fetch the raw data
    public screenshotRef?: string;   // Reference link to fetch the screenshot

    private _html?: string;            // Raw HTML content
    private _markdown?: string;        // Extracted content formatted as Markdown
    private _pdf?: Buffer;             // Base64 encoded PDF
    private _rawData?: Buffer;         // Underlying raw response data
    private _screenshot?: Buffer;      // Base64 encoded screenshot image

    private storageReader?: (ref: string) => Promise<ArrayBuffer>;

    constructor(data: any, storageReader?: (ref: string) => Promise<ArrayBuffer>) {
        if (!data) return;
        this.links = data.links;
        this.htmlRef = data.htmlRef;
        this.markdownRef = data.markdownRef;
        this.metadata = data.metadata;
        this.pdfRef = data.pdfRef;
        this.rawDataRef = data.rawDataRef;
        this.screenshotRef = data.screenshotRef;

        this._html = data.html;
        this._markdown = data.markdown;
        this._pdf = undefined;
        this._rawData = undefined;
        this._screenshot = undefined;
        this.storageReader = storageReader;
    }

    async getHtml(): Promise<string | undefined> {
        if (this._html) return this._html;
        if (this.htmlRef && this.storageReader) {
            const buf = await this.storageReader(this.htmlRef);
            this._html = Buffer.from(buf).toString('utf-8');
            return this._html;
        }
        return undefined;
    }

    async getMarkdown(): Promise<string | undefined> {
        if (this._markdown) return this._markdown;
        if (this.markdownRef && this.storageReader) {
            const buf = await this.storageReader(this.markdownRef);
            this._markdown = Buffer.from(buf).toString('utf-8');
            return this._markdown;
        }
        return undefined;
    }

    async getPdf(): Promise<Buffer | undefined> {
        if (this._pdf) return this._pdf;
        if (this.pdfRef && this.storageReader) {
            const buf = await this.storageReader(this.pdfRef);
            this._pdf = Buffer.from(buf);
            return this._pdf;
        }
        return undefined;
    }

    async getRawData(): Promise<Buffer | undefined> {
        if (this._rawData) return this._rawData;
        if (this.rawDataRef && this.storageReader) {
            const buf = await this.storageReader(this.rawDataRef);
            this._rawData = Buffer.from(buf);
            return this._rawData;
        }
        return undefined;
    }

    async getScreenshot(): Promise<Buffer | undefined> {
        if (this._screenshot) return this._screenshot;
        if (this.screenshotRef && this.storageReader) {
            const buf = await this.storageReader(this.screenshotRef);
            this._screenshot = Buffer.from(buf);
            return this._screenshot;
        }
        return undefined;
    }
}

export interface TaskResultResponseDto {
    code?: number;          // Custom status code
    data?: ScrapeDataDto;   // The extracted scrape/crawl data
    errorCode?: string;     // Error code identifier if any
    errorMessage?: string;  // Detailed error message
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
    data?: ScrapeDataDto;  // Extracted data for this page
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
    data?: CrawlPageItemResponseDto[];   // List of page results
    nextCursor?: string;                 // Cursor for fetching the next page of results
    prevCursor?: string;                 // Cursor for fetching the previous page of results
    total?: number;                      // Total number of pages
}

export interface ListCrawlPagesOptions {
    /** Pages forward; take it from the previous response's nextCursor. */
    afterCursor?: string;
    /** Pages backward; take it from the previous response's prevCursor. */
    beforeCursor?: string;
    /** Page size (server default 20, max 100). */
    limit?: number;
}


