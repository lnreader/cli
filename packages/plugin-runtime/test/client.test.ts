import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { HttpClient, parseRetryAfter } from '../src/net/client.js';
import { mockFetch } from './helpers.js';

const client = (
  fetch: ReturnType<typeof mockFetch>['fetch'],
  sleeps: number[] = [],
) =>
  new HttpClient({
    concurrency: 2,
    minGapMs: 0,
    userAgent: 'test-agent',
    fetch,
    backoffMs: 100,
    sleep: async ms => void sleeps.push(ms),
  });

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    expect(parseRetryAfter('3')).toBe(3000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('HttpClient', () => {
  it('retries 5xx and 429 with backoff, honoring Retry-After', async () => {
    let n = 0;
    const { fetch } = mockFetch({
      'x.test/': () => {
        n++;
        if (n === 1) return new Response('', { status: 503 });
        if (n === 2)
          return new Response('', {
            status: 429,
            headers: { 'retry-after': '0.05' },
          });
        return new Response('ok');
      },
    });
    const sleeps: number[] = [];
    const res = await client(fetch, sleeps).request('https://x.test/');
    expect(await res.text()).toBe('ok');
    expect(n).toBe(3);
    expect(sleeps[0]).toBeGreaterThanOrEqual(100);
    expect(sleeps[0]).toBeLessThan(400);
    expect(sleeps[1]).toBe(50);
  });

  it('returns the last error response once retries are exhausted', async () => {
    const { fetch, calls } = mockFetch({
      'x.test/': () => new Response('', { status: 500 }),
    });
    const res = await client(fetch).request(
      'https://x.test/',
      {},
      { retries: 2 },
    );
    expect(res.status).toBe(500);
    expect(calls).toHaveLength(3);
  });

  it('does not retry 4xx other than 429', async () => {
    const { fetch, calls } = mockFetch({
      'x.test/': () => new Response('', { status: 404 }),
    });
    expect((await client(fetch).request('https://x.test/')).status).toBe(404);
    expect(calls).toHaveLength(1);
  });

  it('keeps cookies set during redirects and sends default headers', async () => {
    const { fetch, calls } = mockFetch({
      'x.test/login': () =>
        new Response('', {
          status: 302,
          headers: { location: '/home', 'set-cookie': 'sid=42; Path=/' },
        }),
      'x.test/home': () => new Response('home'),
    });
    const jar = new CookieJar();
    const res = await client(fetch).request(
      'https://x.test/login',
      { method: 'POST', body: 'a=1', headers: { 'X-Custom': '1' } },
      { jar },
    );
    expect(await res.text()).toBe('home');
    const second = new Headers(calls[1]!.init.headers);
    expect(calls[1]!.init.method).toBe('GET');
    expect(second.get('cookie')).toBe('sid=42');
    expect(second.get('user-agent')).toBe('test-agent');
    expect(second.get('x-custom')).toBe('1');
    expect(await jar.getCookieString('https://x.test/')).toBe('sid=42');
  });

  it('lets callers override the User-Agent', async () => {
    const { fetch, calls } = mockFetch({ 'x.test/': () => new Response('') });
    await client(fetch).request('https://x.test/', {
      headers: { 'User-Agent': 'mine' },
    });
    expect(new Headers(calls[0]!.init.headers).get('user-agent')).toBe('mine');
  });
});
