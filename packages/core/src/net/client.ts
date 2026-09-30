import type { CookieJar } from 'tough-cookie';
import { HostLimiter, type LimiterOptions } from './limiter.js';

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type RequestOptions = {
  jar?: CookieJar;
  /** Retries after the first attempt, for 429, 5xx and network errors. */
  retries?: number;
  signal?: AbortSignal;
};

export type HttpClientOptions = LimiterOptions & {
  userAgent: string;
  fetch?: FetchLike;
  /** Base delay for exponential backoff, in ms. */
  backoffMs?: number;
  /** Upper bound on any single wait, including `Retry-After`. */
  maxDelayMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

const DEFAULT_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'cors',
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => (clearTimeout(t), reject(signal.reason)),
      {
        once: true,
      },
    );
  });
}

/** Parse `Retry-After` as seconds or an HTTP date; returns ms or undefined. */
export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value) return undefined;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

type HeadersInit = ConstructorParameters<typeof Headers>[0];

function toHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers();
  if (init) {
    const source =
      init instanceof Headers ? init : new Headers(init as HeadersInit);
    source.forEach((v, k) => headers.set(k, v));
  }
  return headers;
}

/**
 * Polite HTTP client: per-host rate limiting, cookie jars that also see
 * redirect hops, and retries with exponential backoff honoring `Retry-After`.
 */
export class HttpClient {
  readonly limiter: HostLimiter;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: NonNullable<HttpClientOptions['sleep']>;

  constructor(private readonly options: HttpClientOptions) {
    this.limiter = new HostLimiter(options);
    this.fetchImpl =
      options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.sleep = options.sleep ?? sleep;
  }

  async request(
    url: string,
    init: RequestInit = {},
    opts: RequestOptions = {},
  ): Promise<Response> {
    const retries = opts.retries ?? 3;
    const backoff = this.options.backoffMs ?? 1000;
    const maxDelay = this.options.maxDelayMs ?? 60_000;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      let retryAfter: number | undefined;
      try {
        const res = await this.followRedirects(url, init, opts);
        if (res.status !== 429 && res.status < 500) return res;
        if (attempt === retries) return res;
        retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        await res.body?.cancel().catch(() => {});
        lastError = new HttpError(res.status, url);
      } catch (err) {
        if (opts.signal?.aborted || attempt === retries) throw err;
        lastError = err;
      }
      const jitter = Math.random() * 250;
      const delay = Math.min(
        maxDelay,
        retryAfter ?? backoff * 2 ** attempt + jitter,
      );
      if (retryAfter !== undefined)
        this.limiter.pause(new URL(url).host, delay);
      await this.sleep(delay, opts.signal);
    }
    throw lastError;
  }

  private async followRedirects(
    url: string,
    init: RequestInit,
    opts: RequestOptions,
  ): Promise<Response> {
    let current = url;
    let method = (init.method ?? 'GET').toUpperCase();
    let body = init.body;
    const baseHeaders = toHeaders(init.headers);
    for (const [k, v] of Object.entries(DEFAULT_HEADERS)) {
      if (!baseHeaders.has(k)) baseHeaders.set(k, v);
    }
    if (!baseHeaders.has('user-agent'))
      baseHeaders.set('user-agent', this.options.userAgent);

    for (let hop = 0; hop <= 10; hop++) {
      const headers = new Headers(baseHeaders);
      if (opts.jar) {
        const cookie = await opts.jar.getCookieString(current);
        const own = headers.get('cookie');
        if (cookie) headers.set('cookie', own ? `${own}; ${cookie}` : cookie);
      }
      const res = await this.limiter.run(new URL(current).host, () =>
        this.fetchImpl(current, {
          ...init,
          method,
          body,
          headers,
          redirect: 'manual',
          signal: opts.signal ?? init.signal,
        }),
      );
      if (opts.jar) {
        for (const c of res.headers.getSetCookie()) {
          await opts.jar.setCookie(c, current, { ignoreError: true });
        }
      }
      const location = res.headers.get('location');
      if (!REDIRECTS.has(res.status) || !location || init.redirect === 'manual')
        return res;
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current).href;
      if (
        res.status === 303 ||
        ((res.status === 301 || res.status === 302) && method === 'POST')
      ) {
        method = 'GET';
        body = undefined;
        baseHeaders.delete('content-type');
      }
    }
    throw new Error(`Too many redirects for ${url}`);
  }
}
