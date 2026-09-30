import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { HttpClient, type FetchLike } from '../src/net/client.js';
import { PluginRunner } from '../src/plugins/loader.js';
import type { PluginEntry } from '../src/plugins/registry.js';
import { loadPlugin } from '../src/plugins/sandbox.js';

export const PNG_1PX = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

export const fixtureCode = () =>
  readFile(new URL('./fixtures/fixture-plugin.js', import.meta.url), 'utf8');

export const tempHome = () => mkdtemp(join(tmpdir(), 'lnreader-test-'));

export type Route = (req: {
  url: URL;
  init: RequestInit;
}) => Response | Promise<Response>;

/** A fetch that serves routes by `host + pathname` and records every request. */
export function mockFetch(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: input, init });
    const route = routes[url.host + url.pathname];
    if (!route) return new Response('not found', { status: 404 });
    return route({ url, init });
  };
  return { fetch, calls };
}

const html = (body: string) =>
  new Response(`<!doctype html><html><body>${body}</body></html>`, {
    headers: { 'content-type': 'text/html' },
  });

/** A tiny novel site the fixture plugin knows how to scrape. */
export function novelSite(chapters = 5) {
  const links = Array.from(
    { length: chapters },
    (_, i) => `<a href="/novel/abc/${i + 1}">Chapter ${i + 1}</a>`,
  );
  return mockFetch({
    'novels.test/search': ({ url }) =>
      html(
        `<div class="result"><a href="/novel/abc" data-cover="https://novels.test/cover.png">Result for ${url.searchParams.get('q')}</a></div>`,
      ),
    'novels.test/novel/abc': () =>
      html(`<h1>The Test Novel</h1><span class="author">Jane Writer</span>
        <img class="cover" src="https://novels.test/cover.png">
        <span class="genre">Fantasy</span><span class="genre">Action</span>
        <p class="summary">A summary &amp; more.</p>
        <div class="chapters">${links.join('')}</div>`),
    ...Object.fromEntries(
      Array.from({ length: chapters }, (_, i) => [
        `novels.test/novel/abc/${i + 1}`,
        () =>
          html(`<div id="content"><p>Text of chapter ${i + 1} &mdash; ünïcödé 日本語</p>
            <script>alert(1)</script><p onclick="x()">Second<br>line</p>
            ${i === 1 ? '<img src="/img.png" width="10"><img src="/broken.png">' : ''}</div>`),
      ]),
    ),
    'novels.test/cover.png': () => new Response(PNG_1PX),
    'novels.test/img.png': ({ init }) =>
      new Headers(init.headers).get('x-image-token') === 'abc'
        ? new Response(PNG_1PX)
        : new Response('forbidden', { status: 403 }),
  });
}

export const fixtureEntry: PluginEntry = {
  id: 'fixture',
  name: 'Fixture',
  site: 'https://novels.test/',
  lang: 'English',
  version: '1.0.0',
  url: 'https://repo.test/fixture.js',
  repo: 'https://repo.test/plugins.min.json',
};

export async function fixtureRunner(fetch: FetchLike, home: string) {
  const http = new HttpClient({
    concurrency: 2,
    minGapMs: 0,
    userAgent: 'test-agent',
    fetch,
  });
  const jar = new CookieJar();
  const plugin = loadPlugin(await fixtureCode(), 'fixture', {
    http,
    jar,
    storageFile: join(home, 'storage.json'),
  });
  return { http, jar, runner: new PluginRunner(fixtureEntry, plugin, 5_000) };
}
