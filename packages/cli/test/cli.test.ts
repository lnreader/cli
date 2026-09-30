import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const FIXTURE = new URL(
  '../../core/test/fixtures/fixture-plugin.js',
  import.meta.url,
);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let server: Server;
let base: string;
let home: string;
/** Chapters the fake site currently lists. */
let chapterCount = 3;

/** Serves a plugin repo, the fixture plugin (pointed at this server) and a novel site. */
beforeAll(async () => {
  const code = await readFile(FIXTURE, 'utf8');
  const page = (body: string) =>
    `<!doctype html><html><body>${body}</body></html>`;
  server = createServer((req, res) => {
    const url = new URL(req.url!, base);
    const send = (
      status: number,
      body: string | Buffer,
      type = 'text/html',
    ) => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };
    if (url.pathname === '/plugins.min.json') {
      return send(
        200,
        JSON.stringify([
          {
            id: 'fixture',
            name: 'Fixture',
            site: `${base}/`,
            lang: 'English',
            version: '1.0.0',
            url: `${base}/fixture.js`,
          },
          {
            id: 'banned',
            name: 'Banned',
            site: 'https://banned.test/',
            lang: 'English',
            version: '1.0.0',
            url: `${base}/x.js`,
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
        code.replaceAll('https://novels.test/', `${base}/`),
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
    if (url.pathname === '/novel/abc') {
      return send(
        200,
        page(`<h1>CLI Novel</h1><span class="author">A. Author</span>
        <img class="cover" src="${base}/cover.png"><p class="summary">Summary.</p>
        <div class="chapters">${Array.from(
          { length: chapterCount },
          (_, i) => i + 1,
        )
          .map(i => `<a href="/novel/abc/${i}">Chapter ${i}</a>`)
          .join('')}</div>`),
      );
    }
    const ch = url.pathname.match(/^\/novel\/abc\/(\d+)$/);
    if (ch)
      return send(200, page(`<div id="content"><p>Body ${ch[1]}</p></div>`));
    if (url.pathname === '/cover.png') return send(200, PNG, 'image/png');
    send(404, 'not found');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  home = await mkdtemp(join(tmpdir(), 'lnreader-cli-'));
  await mkdir(join(home, 'config'), { recursive: true });
  await writeFile(
    join(home, 'config', 'config.json'),
    JSON.stringify({
      repos: [`${base}/plugins.min.json`],
      blacklistUrl: `${base}/blacklist.json`,
      minGapMs: 0,
    }),
  );
});

afterAll(() => server?.close());

const lnreader = (...args: string[]) =>
  run(
    process.execPath,
    ['--import', 'tsx', '--conditions=source', CLI, '--home', home, ...args],
    {
      env: {
        ...process.env,
        NO_COLOR: '1',
        NO_PROXY: '127.0.0.1',
        no_proxy: '127.0.0.1',
      },
    },
  );

describe('lnreader', () => {
  it('lists plugins without blacklisted ones', async () => {
    const { stdout } = await lnreader('plugins', 'list', '--json');
    expect(JSON.parse(stdout).map((p: { id: string }) => p.id)).toEqual([
      'fixture',
    ]);
  });

  it('searches, then downloads by result number', async () => {
    const search = await lnreader('search', 'dragons', '-p', 'fixture');
    expect(search.stdout).toContain('Found dragons');
    expect(search.stdout).toMatch(/1\s+Found dragons/);

    const info = await lnreader('info', '1', '--json');
    expect(JSON.parse(info.stdout)).toMatchObject({
      name: 'CLI Novel',
      author: 'A. Author',
      chapterCount: 3,
    });

    const out = join(home, 'books');
    const dl = await lnreader('download', '1', '--out', out, '--json');
    expect(JSON.parse(dl.stdout)).toMatchObject({ chapters: 3, failed: [] });
    expect(await readdir(out)).toEqual(['CLI Novel.epub']);
  }, 60_000);

  it('accepts a URL and resolves the plugin from its site', async () => {
    const { stdout } = await lnreader('info', `${base}/novel/abc`, '--json');
    expect(JSON.parse(stdout)).toMatchObject({
      plugin: { id: 'fixture' },
      path: 'novel/abc',
    });
  }, 30_000);

  it('fails with a usage error when the novel is missing and stdin is not a TTY', async () => {
    await expect(lnreader('download')).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('Missing <novel>'),
    });
  });

  it('prints numbered results when not interactive', async () => {
    const { stdout, stderr } = await lnreader(
      '--no-interactive',
      'search',
      'x',
      '-p',
      'fixture',
    );
    expect(stdout).toMatch(/1\s+Found x/);
    expect(stderr).toContain('lnreader download <n>');
  });

  it('follows, lists, updates and unfollows a novel', async () => {
    const out = join(home, 'library');
    chapterCount = 3;
    const follow = await lnreader('follow', 'fixture:novel/abc', '--out', out);
    expect(follow.stderr).toContain('Following CLI Novel');
    expect(await readdir(out)).toEqual(['CLI Novel.epub']);

    const list = JSON.parse((await lnreader('list', '--json')).stdout);
    expect(list).toMatchObject([
      { name: 'CLI Novel', knownCount: 3, options: { outDir: out } },
    ]);

    const upToDate = await lnreader('update', '--all');
    expect(upToDate.stderr).toContain('up to date (3 chapters)');

    chapterCount = 5;
    const delta = await lnreader('update', '1', '--delta', '--json');
    expect(JSON.parse(delta.stdout)).toMatchObject([
      { status: 'updated', added: [4, 5], failed: [] },
    ]);
    expect((await readdir(out)).sort()).toEqual([
      'CLI Novel - New Chapters (Ch 4-5).epub',
      'CLI Novel.epub',
    ]);

    await expect(lnreader('update')).rejects.toMatchObject({
      stderr: expect.stringContaining('pass --all'),
    });

    await lnreader('unfollow', 'cli novel');
    expect(JSON.parse((await lnreader('list', '--json')).stdout)).toEqual([]);
  }, 60_000);

  it('gets and sets global settings', async () => {
    await lnreader('config', 'set', 'concurrency', '3');
    expect((await lnreader('config', 'get', 'concurrency')).stdout.trim()).toBe(
      '3',
    );
    expect(
      JSON.parse((await lnreader('config', 'get', '--json')).stdout),
    ).toMatchObject({
      concurrency: 3,
      minGapMs: 0,
    });
    await lnreader('config', 'unset', 'concurrency');
    expect((await lnreader('config', 'get', 'concurrency')).stdout.trim()).toBe(
      '2',
    );
    await expect(
      lnreader('config', 'set', 'concurrency', 'lots'),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Invalid value for concurrency'),
    });
    await expect(lnreader('config', 'set', 'nope', '1')).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown setting "nope"'),
    });
    await expect(lnreader('config', 'set', 'repos', 'x')).rejects.toMatchObject(
      {
        stderr: expect.stringContaining('plugins repo add'),
      },
    );
  }, 30_000);

  it('gets and sets plugin settings', async () => {
    await lnreader('config', 'set', '--plugin', 'fixture', 'apiKey', 's3cret');
    await lnreader('config', 'set', '--plugin', 'fixture', 'nsfw', 'on');
    const table = (await lnreader('config', 'get', '--plugin', 'fixture'))
      .stdout;
    expect(table).toContain('Show NSFW');
    expect(table).not.toContain('s3cret');
    expect(
      JSON.parse(
        (await lnreader('config', 'get', '--plugin', 'fixture', '--json'))
          .stdout,
      ),
    ).toEqual({
      apiKey: 's3cret',
      nsfw: true,
    });
    await expect(
      lnreader('config', 'set', '--plugin', 'fixture', 'nsfw', 'maybe'),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('is a switch'),
    });
  }, 30_000);

  it('browses popular novels with filters', async () => {
    const popular = await lnreader(
      'popular',
      '-p',
      'fixture',
      '--no-interactive',
    );
    expect(popular.stdout).toMatch(/1\s+Popular popular 1/);

    const latest = await lnreader(
      'popular',
      '-p',
      'fixture',
      '--latest',
      '-f',
      'order=Newest',
      '--page',
      '2',
      '--json',
    );
    expect(JSON.parse(latest.stdout)).toEqual([
      { name: 'Latest new 2', path: 'novel/abc' },
    ]);

    const filters = await lnreader('popular', '-p', 'fixture', '--filters');
    expect(filters.stdout).toContain('one of: popular, new');

    await expect(
      lnreader('popular', '-p', 'fixture', '-f', 'order=oldest'),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown option "oldest" for order'),
    });
    await expect(lnreader('popular')).rejects.toMatchObject({
      stderr: expect.stringContaining('Missing --plugin'),
    });

    // Results can be used by number, like search results.
    const info = await lnreader('info', '1', '--json');
    expect(JSON.parse(info.stdout)).toMatchObject({ name: 'CLI Novel' });
  }, 60_000);

  it('clears saved sign-in data and validates the browser', async () => {
    const cleared = await lnreader('auth', 'fixture', '--clear');
    expect(cleared.stderr).toContain(
      'Cleared saved cookies and User-Agent for fixture',
    );
    await expect(
      lnreader('auth', 'fixture', '--browser', 'firefox'),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('--browser must be chrome or msedge'),
    });
  }, 30_000);

  it('refuses unknown formats', async () => {
    await expect(
      lnreader('download', 'fixture:novel/abc', '--format', 'pdf'),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Unsupported format'),
    });
  });
});
