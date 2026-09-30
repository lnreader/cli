import { execFile } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTPUT_SCHEMAS } from '../src/schemas.js';
import { startSite, type Site } from './site.js';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let site: Site;
let base: string;
let home: string;

beforeAll(async () => {
  site = await startSite();
  ({ base, home } = site);
});

afterAll(() => site?.close());

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
      code: 2,
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
    site.chapterCount = 3;
    const follow = await lnreader('follow', 'fixture:novel/abc', '--out', out);
    expect(follow.stderr).toContain('Following CLI Novel');
    expect(await readdir(out)).toEqual(['CLI Novel.epub']);

    const list = JSON.parse((await lnreader('list', '--json')).stdout);
    expect(list).toMatchObject([
      { name: 'CLI Novel', knownCount: 3, options: { outDir: out } },
    ]);

    const upToDate = await lnreader('update', '--all');
    expect(upToDate.stderr).toContain('up to date (3 chapters)');

    site.chapterCount = 5;
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

const fails = async (...args: string[]) => {
  try {
    await lnreader(...args);
  } catch (e) {
    return e as { code: number; stdout: string; stderr: string };
  }
  throw new Error(`expected lnreader ${args.join(' ')} to fail`);
};

describe('lnreader for agents', () => {
  it('reads a chapter as Markdown, text and numbered paragraphs', async () => {
    const md = await lnreader('read', 'fixture:novel/abc', '2');
    expect(md.stdout).toBe(
      '# Chapter 2\n\nBody 2 with _style_.\n\nSecond paragraph of chapter 2.\n',
    );
    const text = await lnreader(
      'read',
      'fixture:novel/abc',
      'ch:2',
      '--format',
      'text',
    );
    expect(text.stdout).toBe(
      'Chapter 2\n\nBody 2 with style.\n\nSecond paragraph of chapter 2.\n',
    );
    const numbered = await lnreader(
      'read',
      `${base}/novel/abc`,
      'novel/abc/2',
      '--format',
      'numbered',
    );
    expect(numbered.stdout).toBe(
      '# Chapter 2\n\n[1] Body 2 with style.\n[2] Second paragraph of chapter 2.\n',
    );
  }, 30_000);

  it('reads chunks with --offset and --max-chars as JSON', async () => {
    const first = JSON.parse(
      (
        await lnreader(
          'read',
          'fixture:novel/abc',
          '1',
          '--max-chars',
          '30',
          '--json',
        )
      ).stdout,
    );
    OUTPUT_SCHEMAS.read.parse(first);
    expect(first).toMatchObject({
      novel: { plugin: 'fixture', path: 'novel/abc', name: 'CLI Novel' },
      chapter: { index: 1, name: 'Chapter 1', path: 'novel/abc/1' },
      totalChapters: expect.any(Number),
      format: 'md',
      offset: 0,
      content: '# Chapter 1\n\nBody 1 with',
    });
    const rest = JSON.parse(
      (
        await lnreader(
          'read',
          'fixture:novel/abc',
          '1',
          '--offset',
          String(first.nextOffset),
          '--json',
        )
      ).stdout,
    );
    expect(rest.cached).toBe(true);
    expect(rest.nextOffset).toBeUndefined();
    expect(first.content + ' ' + rest.content).toBe(
      '# Chapter 1\n\nBody 1 with _style_.\n\nSecond paragraph of chapter 1.',
    );
  }, 30_000);

  it('streams a range of chapters separated by headings', async () => {
    const { stdout } = await lnreader(
      'read',
      'fixture:novel/abc',
      '--from',
      '1',
      '--to',
      '3',
      '--format',
      'text',
    );
    expect(stdout.match(/^Chapter \d$/gm)).toEqual([
      'Chapter 1',
      'Chapter 2',
      'Chapter 3',
    ]);
    const json = JSON.parse(
      (await lnreader('read', 'fixture:novel/abc', '--from', '2', '--json'))
        .stdout,
    );
    OUTPUT_SCHEMAS.read.parse(json);
    expect(json.chapters.map((c: { index: number }) => c.index)).toEqual(
      Array.from({ length: json.totalChapters - 1 }, (_, i) => i + 2),
    );
  }, 30_000);

  it('prints structured errors with --json', async () => {
    const missing = await fails('read', 'fixture:novel/abc', '99', '--json');
    expect(missing.code).toBe(1);
    expect(OUTPUT_SCHEMAS.error.parse(JSON.parse(missing.stdout))).toEqual({
      error: {
        code: 'CHAPTER_NOT_FOUND',
        message: expect.stringContaining('No chapter #99'),
        hint: expect.any(String),
      },
    });

    const usage = await fails('read', '--json');
    expect(usage.code).toBe(2);
    expect(JSON.parse(usage.stdout).error.code).toBe('USAGE');

    const badFlag = await fails('search', 'x', '--nope', '--json');
    expect(badFlag.code).toBe(2);
    expect(JSON.parse(badFlag.stdout).error).toMatchObject({
      code: 'USAGE',
      message: expect.stringContaining('--nope'),
    });

    const unknown = await fails('info', 'nope:x', '--json');
    expect(JSON.parse(unknown.stdout).error.code).toBe('PLUGIN_NOT_FOUND');
  }, 30_000);

  it('reports a Cloudflare challenge as NEEDS_AUTH', async () => {
    const { stdout, stderr } = await fails(
      'info',
      'fixture:novel/cf',
      '--json',
    );
    expect(JSON.parse(stdout).error).toMatchObject({
      code: 'NEEDS_AUTH',
      hint: expect.stringContaining('lnreader auth fixture'),
    });
    expect(stderr).toContain('lnreader auth fixture');
  }, 30_000);

  it('stops a range at the session fetch budget; cached reads are free', async () => {
    const small = await startSite({ sessionFetchBudget: 2 });
    const read = (...args: string[]) => [
      '--home',
      small.home,
      'read',
      'fixture:novel/abc',
      ...args,
      '--json',
    ];
    try {
      const over = await fails(...read('--from', '1'));
      expect(JSON.parse(over.stdout).error).toMatchObject({
        code: 'BUDGET_EXCEEDED',
        hint: expect.stringContaining('sessionFetchBudget'),
      });
      expect(small.hits.get('/novel/abc/1')).toBeUndefined();

      await lnreader(...read('--to', '2'));
      // Chapters 1 and 2 are cached now, so only chapter 3 counts.
      const all = JSON.parse((await lnreader(...read('--from', '1'))).stdout);
      expect(all.chapters.map((c: { cached: boolean }) => c.cached)).toEqual([
        true,
        true,
        false,
      ]);
    } finally {
      await small.close();
    }
  }, 30_000);

  it('prints JSON Schemas for command output', async () => {
    const names = JSON.parse((await lnreader('schema', '--json')).stdout);
    expect(names).toEqual(expect.arrayContaining(['read', 'search', 'error']));
    const schema = JSON.parse((await lnreader('schema', 'read')).stdout);
    expect(schema.anyOf).toHaveLength(2);
    const plugins = JSON.parse(
      (await lnreader('schema', 'plugins', 'list')).stdout,
    );
    expect(plugins.type).toBe('array');
    expect((await fails('schema', 'nope')).stderr).toContain(
      'No schema for "nope"',
    );
  }, 30_000);

  it('matches the published schemas', async () => {
    const json = async (...args: string[]) =>
      JSON.parse((await lnreader(...args, '--json')).stdout);
    OUTPUT_SCHEMAS['plugins list'].parse(await json('plugins', 'list'));
    OUTPUT_SCHEMAS['plugins repo list'].parse(
      await json('plugins', 'repo', 'list'),
    );
    OUTPUT_SCHEMAS.search.parse(await json('search', 'x', '-p', 'fixture'));
    OUTPUT_SCHEMAS.popular.parse(await json('popular', '-p', 'fixture'));
    OUTPUT_SCHEMAS.info.parse(
      await json('info', 'fixture:novel/abc', '--chapters'),
    );
    OUTPUT_SCHEMAS['config get'].parse(await json('config', 'get'));
    OUTPUT_SCHEMAS.download.parse(
      await json(
        'download',
        'fixture:novel/abc',
        '--out',
        join(home, 'schema'),
      ),
    );
    const follow = await json(
      'follow',
      'fixture:novel/abc',
      '--out',
      join(home, 'schema'),
    );
    OUTPUT_SCHEMAS.follow.parse(follow);
    expect(follow.update.status).toBe('updated');
    OUTPUT_SCHEMAS.list.parse(await json('list'));
    OUTPUT_SCHEMAS.update.parse(await json('update', '--all'));
    OUTPUT_SCHEMAS.unfollow.parse(await json('unfollow', 'cli novel'));
    const test = await json('plugins', 'test', 'fixture');
    OUTPUT_SCHEMAS['plugins test'].parse(test);
    expect(test).toMatchObject({ plugin: 'fixture', ok: true });
    expect(test.steps.map((s: { step: string }) => s.step)).toEqual([
      'load',
      'popular',
      'search',
      'novel',
      'chapter',
    ]);
  }, 90_000);

  it('keeps stderr empty with --quiet', async () => {
    const { stderr } = await lnreader(
      '--quiet',
      'download',
      'fixture:novel/abc',
      '--out',
      join(home, 'quiet'),
    );
    expect(stderr).toBe('');
    expect(await readdir(join(home, 'quiet'))).toEqual(['CLI Novel.epub']);
  }, 30_000);

  it('writes MCP client config without touching other keys', async () => {
    const file = join(home, 'client.json');
    await writeFile(
      file,
      JSON.stringify({
        theme: 'dark',
        mcpServers: { other: { command: 'x' } },
      }),
    );
    const added = JSON.parse(
      (
        await lnreader(
          'mcp',
          'install',
          '--client',
          'cursor',
          '--config',
          file,
          '--json',
        )
      ).stdout,
    );
    expect(added.status).toBe('added');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      theme: 'dark',
      mcpServers: {
        other: { command: 'x' },
        lnreader: {
          command: 'npx',
          args: ['-y', 'lnreader-cli', 'mcp'],
          env: { LNREADER_HOME: home },
        },
      },
    });
    const again = await lnreader(
      'mcp',
      'install',
      '--client',
      'cursor',
      '--config',
      file,
    );
    expect(again.stderr).toContain('already set up');

    await writeFile(file, '{ not json');
    expect(
      (await fails('mcp', 'install', '--client', 'cursor', '--config', file))
        .stderr,
    ).toContain('not valid JSON');
    expect(
      (await fails('mcp', 'install', '--client', 'vim', '--config', file))
        .stderr,
    ).toContain('Unknown client');
  }, 30_000);

  it('installs the agent skill', async () => {
    const dir = join(home, 'skills');
    const result = JSON.parse(
      (await lnreader('skill', 'install', '--dir', dir, '--json')).stdout,
    );
    expect(result).toEqual({
      file: join(dir, 'lnreader', 'SKILL.md'),
      status: 'installed',
    });
    const skill = await readFile(result.file, 'utf8');
    expect(skill).toMatch(/^---\nname: lnreader\n/);
    expect(skill).toContain('NEEDS_AUTH');
  }, 30_000);
});
