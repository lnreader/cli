import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it, vi } from 'vitest';
import { HttpClient, parseRetryAfter } from '../src/net/client.js';
import { createImpitFetch } from '../src/net/impit.js';
import { DEFAULT_USER_AGENT } from '../src/store/config.js';
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

  it('emulates a browser with impit by default', async () => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.headers));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      const http = new HttpClient({
        concurrency: 1,
        minGapMs: 0,
        userAgent: DEFAULT_USER_AGENT,
      });
      const defaultHeaders = (await (await http.request(url)).json()) as Record<
        string,
        string
      >;
      expect(defaultHeaders['user-agent']).toBe(DEFAULT_USER_AGENT);
      expect(defaultHeaders['sec-ch-ua']).toContain('Google Chrome');
      expect(defaultHeaders['sec-fetch-mode']).toBe('navigate');
      expect(defaultHeaders['sec-fetch-site']).toBe('none');
      expect(defaultHeaders['referer']).toBeUndefined();

      const sameOriginHeaders = (await (
        await http.request(url, { headers: { referer: url } })
      ).json()) as Record<string, string>;
      expect(sameOriginHeaders['sec-fetch-site']).toBe('same-origin');

      const crossSiteHeaders = (await (
        await http.request(url, {
          headers: { referer: 'https://other.test/' },
        })
      ).json()) as Record<string, string>;
      expect(crossSiteHeaders['sec-fetch-site']).toBe('cross-site');

      const customHeaders = (await (
        await http.request(url, {}, { userAgent: 'CustomBrowser/1.0' })
      ).json()) as Record<string, string>;
      expect(customHeaders['user-agent']).toBe('CustomBrowser/1.0');
      expect(customHeaders['sec-ch-ua']).toBeUndefined();

      const imageHeaders = (await (
        await http.request(url, {
          headers: { accept: 'image/avif,image/webp,image/*;q=0.8' },
        })
      ).json()) as Record<string, string>;
      expect(imageHeaders['sec-fetch-mode']).toBe('no-cors');
      expect(imageHeaders['sec-fetch-dest']).toBe('image');
      expect(imageHeaders['upgrade-insecure-requests']).toBeUndefined();

      const jsonHeaders = (await (
        await http.request(url, {
          headers: { accept: 'application/json' },
        })
      ).json()) as Record<string, string>;
      expect(jsonHeaders['sec-fetch-mode']).toBe('cors');
      expect(jsonHeaders['sec-fetch-dest']).toBe('empty');
    } finally {
      server.closeAllConnections();
      await new Promise<void>(r => server.close(() => r()));
    }
  });

  it('falls back to globalThis.fetch when impit fails to load', async () => {
    const load = vi.fn(async () => {
      throw new Error('Cannot find native binding');
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('fallback'));
    try {
      const fetchImpl = createImpitFetch(load);
      const init: RequestInit = {
        headers: { 'user-agent': DEFAULT_USER_AGENT },
      };
      const first = await fetchImpl('https://x.test/1', init);
      const second = await fetchImpl('https://x.test/2', {
        headers: { accept: 'application/json' },
      });
      expect(await first.text()).toBe('fallback');
      expect(await second.text()).toBe('fallback');
      expect(load).toHaveBeenCalledTimes(1);
      const firstHeaders = new Headers(fetchSpy.mock.calls[0]![1]?.headers);
      expect(firstHeaders.get('user-agent')).toBe(DEFAULT_USER_AGENT);
      expect(firstHeaders.get('accept')).toBe('*/*');
      expect(firstHeaders.get('accept-language')).toBe('en-US,en;q=0.9');
      expect(firstHeaders.get('sec-fetch-mode')).toBe('cors');
      const secondHeaders = new Headers(fetchSpy.mock.calls[1]![1]?.headers);
      expect(secondHeaders.get('accept')).toBe('application/json');
      expect(secondHeaders.get('accept-language')).toBe('en-US,en;q=0.9');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
