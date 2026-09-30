import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = new URL(
  '../../plugin-runtime/test/fixtures/fixture-plugin.js',
  import.meta.url,
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export type Site = {
  base: string;
  /** A fresh `--home` whose config points at this site. */
  home: string;
  /** Chapters the fake novel currently lists. */
  chapterCount: number;
  /** Requests per path, to check what was fetched. */
  hits: Map<string, number>;
  close(): Promise<void>;
};

/**
 * Serves a plugin repo, a blacklist, the fixture plugin (pointed at this
 * server) and a novel site. `/novel/cf` answers with a Cloudflare challenge.
 */
export async function startSite(
  config: Record<string, unknown> = {},
): Promise<Site> {
  const code = await readFile(FIXTURE, 'utf8');
  const page = (body: string) =>
    `<!doctype html><html><body>${body}</body></html>`;
  const site = { chapterCount: 3, hits: new Map<string, number>() } as Site;
  const server = createServer((req, res) => {
    const url = new URL(req.url!, site.base);
    site.hits.set(url.pathname, (site.hits.get(url.pathname) ?? 0) + 1);
    const send = (
      status: number,
      body: string | Buffer,
      type = 'text/html',
      headers: Record<string, string> = {},
    ) => {
      res.writeHead(status, { 'content-type': type, ...headers });
      res.end(body);
    };
    if (url.pathname === '/plugins.min.json') {
      return send(
        200,
        JSON.stringify([
          {
            id: 'fixture',
            name: 'Fixture',
            site: `${site.base}/`,
            lang: 'English',
            version: '1.0.0',
            url: `${site.base}/fixture.js`,
          },
          {
            id: 'banned',
            name: 'Banned',
            site: 'https://banned.test/',
            lang: 'English',
            version: '1.0.0',
            url: `${site.base}/x.js`,
          },
        ]),
        'application/json',
      );
    }
    if (url.pathname === '/blacklist.json') {
      return send(
        200,
        JSON.stringify([{ name: 'Banned', site: 'https://banned.test/' }]),
        'application/json',
      );
    }
    if (url.pathname === '/fixture.js')
      return send(
        200,
        code.replaceAll('https://novels.test/', `${site.base}/`),
        'text/javascript',
      );
    if (url.pathname === '/search') {
      return send(
        200,
        page(
          `<div class="result"><a href="/novel/abc">Found ${url.searchParams.get('q')}</a></div>`,
        ),
      );
    }
    if (url.pathname === '/novel/cf') {
      return send(403, page('<title>Just a moment...</title>'), 'text/html', {
        'cf-mitigated': 'challenge',
        server: 'cloudflare',
      });
    }
    if (url.pathname === '/novel/abc') {
      return send(
        200,
        page(`<h1>CLI Novel</h1><span class="author">A. Author</span>
        <img class="cover" src="${site.base}/cover.png"><p class="summary">Summary.</p>
        <div class="chapters">${Array.from(
          { length: site.chapterCount },
          (_, i) => i + 1,
        )
          .map(i => `<a href="/novel/abc/${i}">Chapter ${i}</a>`)
          .join('')}</div>`),
      );
    }
    const ch = url.pathname.match(/^\/novel\/abc\/(\d+)$/);
    if (ch)
      return send(
        200,
        page(
          `<div id="content"><h3>Chapter ${ch[1]}</h3><p>Body ${ch[1]} with <em>style</em>.</p>` +
            `<p>Second paragraph of chapter ${ch[1]}.</p><script>alert(1)</script></div>`,
        ),
      );
    if (url.pathname === '/cover.png') return send(200, PNG, 'image/png');
    send(404, 'not found');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  site.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  site.home = await mkdtemp(join(tmpdir(), 'lnreader-cli-'));
  await mkdir(join(site.home, 'config'), { recursive: true });
  await writeFile(
    join(site.home, 'config', 'config.json'),
    JSON.stringify({
      repos: [`${site.base}/plugins.min.json`],
      blacklistUrl: `${site.base}/blacklist.json`,
      minGapMs: 0,
      ...config,
    }),
  );
  site.close = () =>
    new Promise<void>(r => {
      server.closeAllConnections();
      server.close(() => r());
    });
  return site;
}
