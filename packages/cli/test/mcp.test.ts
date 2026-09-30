import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRuntime, type Runtime } from '@lnreader/plugin-runtime';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpServer } from '../src/mcp/server.js';
import { startSite, type Site } from './site.js';

let site: Site;
let rt: Runtime;
let client: Client;

async function connect(runtime: Runtime): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'test', version: '1.0.0' });
  await Promise.all([
    createMcpServer(runtime).connect(serverSide),
    c.connect(clientSide),
  ]);
  return c;
}

type Result = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
};

async function call(
  name: string,
  args: Record<string, unknown> = {},
  c = client,
) {
  const res = (await c.callTool({ name, arguments: args })) as Result;
  return res;
}

async function data(name: string, args: Record<string, unknown> = {}) {
  const res = await call(name, args);
  if (res.isError) throw new Error(res.content[0]!.text);
  // The text and the structured content carry the same JSON.
  expect(JSON.parse(res.content[0]!.text)).toEqual(res.structuredContent);
  return res.structuredContent as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

beforeAll(async () => {
  site = await startSite({ sessionFetchBudget: 4 });
  rt = await createRuntime({ home: site.home });
  client = await connect(rt);
});

afterAll(async () => {
  await client?.close();
  await rt?.close();
  await site?.close();
});

describe('lnreader mcp', () => {
  it('lists the tools with read/write annotations', async () => {
    const { tools } = await client.listTools();
    const hints = Object.fromEntries(
      tools.map(t => [t.name, t.annotations?.readOnlyHint]),
    );
    expect(hints).toEqual({
      search_novels: true,
      popular_novels: true,
      get_novel: true,
      read_chapter: false,
      list_plugins: true,
      list_library: true,
      follow_novel: false,
      update_library: false,
      download_epub: false,
      test_plugin: true,
    });
    expect(client.getInstructions()).toContain('untrusted');
  });

  it('hides blacklisted plugins', async () => {
    const { plugins } = await data('list_plugins');
    expect(plugins.map((p: { id: string }) => p.id)).toEqual(['fixture']);
    const banned = await call('popular_novels', { plugin: 'banned' });
    expect(banned.isError).toBe(true);
    expect(banned.content[0]!.text).toMatch(/^PLUGIN_NOT_FOUND:/);
  });

  it('searches, gets a novel and reads a chapter in chunks', async () => {
    const { results } = await data('search_novels', {
      query: 'dragons',
      plugin: 'fixture',
    });
    expect(results).toEqual([
      {
        plugin: 'fixture',
        source: 'Fixture',
        path: 'novel/abc',
        name: 'Found dragons',
      },
    ]);

    const novel = await data('get_novel', {
      novel: results[0],
      chapter_page_size: 2,
      chapter_page: 2,
    });
    expect(novel).toMatchObject({
      name: 'CLI Novel',
      total_chapters: 3,
      chapter_pages: 2,
      chapters: [{ index: 3, name: 'Chapter 3', path: 'novel/abc/3' }],
      followed: false,
    });

    const first = await data('read_chapter', {
      novel: 'fixture:novel/abc',
      chapter: 1,
      max_chars: 30,
    });
    expect(first).toMatchObject({
      chapter: { index: 1, name: 'Chapter 1' },
      next_chapter: 2,
      cached: false,
      content: '# Chapter 1\n\nBody 1 with',
      content_notice: expect.stringContaining('Untrusted'),
    });
    const rest = await data('read_chapter', {
      novel: 'fixture:novel/abc',
      chapter: 'ch:1',
      offset: first.next_offset,
      format: 'numbered',
    });
    expect(rest.cached).toBe(true);
    expect(rest.next_offset).toBeUndefined();
  });

  it('rejects chunks above the hard cap', async () => {
    const res = await call('read_chapter', {
      novel: 'fixture:novel/abc',
      chapter: 1,
      max_chars: 100_001,
    });
    expect(res.isError).toBe(true);
  });

  it('returns coded errors with hints', async () => {
    const missing = await call('read_chapter', {
      novel: 'fixture:novel/abc',
      chapter: 42,
    });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { error: { code: 'CHAPTER_NOT_FOUND' } },
    });

    const challenged = await call('get_novel', { novel: 'fixture:novel/cf' });
    expect(challenged.isError).toBe(true);
    expect(challenged.content[0]!.text).toMatch(
      /^NEEDS_AUTH: .*\nHint: .*lnreader auth fixture/s,
    );

    const index = await call('get_novel', { novel: '1' });
    expect(index.structuredContent).toMatchObject({
      error: { code: 'INVALID_INPUT' },
    });
  });

  it('follows, checks for new chapters and delivers them as a delta EPUB', async () => {
    const followed = await data('follow_novel', { novel: 'fixture:novel/abc' });
    expect(followed).toMatchObject({
      followed: { name: 'CLI Novel', new_chapters: 0 },
      already_followed: false,
    });

    const check = await data('update_library');
    expect(check.novels).toMatchObject([
      {
        name: 'CLI Novel',
        total_chapters: 3,
        new_chapters: [{ index: 1 }, { index: 2 }, { index: 3 }],
        failed: [],
      },
    ]);
    const { novels } = await data('list_library');
    expect(novels).toMatchObject([{ total_chapters: 3, new_chapters: 3 }]);

    const delta = await data('download_epub', {
      novel: 'fixture:novel/abc',
      delta: true,
    });
    const outDir = join(site.home, 'data', 'books');
    expect(delta).toMatchObject({
      output_dir: outDir,
      files: [join(outDir, 'CLI Novel - New Chapters (Ch 1-3).epub')],
      chapters: 3,
      failed: [],
    });
    expect(await readdir(outDir)).toEqual([
      'CLI Novel - New Chapters (Ch 1-3).epub',
    ]);

    const again = await data('download_epub', {
      novel: 'fixture:novel/abc',
      delta: true,
    });
    expect(again).toMatchObject({ files: [], chapters: 0 });

    const unfollowed = await data('follow_novel', {
      novel: 'fixture:novel/abc',
      unfollow: true,
    });
    expect(unfollowed.unfollowed.name).toBe('CLI Novel');
    expect((await data('list_library')).novels).toEqual([]);
  });

  it('writes EPUBs only inside the output folder', async () => {
    const res = await data('download_epub', {
      novel: 'fixture:novel/abc',
      from: 2,
      to: 3,
    });
    expect(res.files).toEqual([
      join(site.home, 'data', 'books', 'CLI Novel.epub'),
    ]);
  });

  it('enforces the per-host session budget; cached reads stay free', async () => {
    // Chapters 1-3 are cached by now; 5 more are new and uncached.
    site.chapterCount = 8;
    const fresh = await createRuntime({ home: site.home });
    const c = await connect(fresh);
    try {
      for (const chapter of [1, 2, 3, 4, 5, 6, 7])
        expect(
          (
            await call(
              'read_chapter',
              { novel: 'fixture:novel/abc', chapter },
              c,
            )
          ).isError,
        ).toBeFalsy();
      const over = await call(
        'read_chapter',
        { novel: 'fixture:novel/abc', chapter: 8 },
        c,
      );
      expect(over.structuredContent).toMatchObject({
        error: {
          code: 'BUDGET_EXCEEDED',
          hint: expect.stringContaining('sessionFetchBudget'),
        },
      });
      const cached = await call(
        'read_chapter',
        { novel: 'fixture:novel/abc', chapter: 1 },
        c,
      );
      expect(cached.isError).toBeFalsy();
      const download = await call(
        'download_epub',
        { novel: 'fixture:novel/abc' },
        c,
      );
      expect(download.structuredContent).toMatchObject({
        error: { code: 'BUDGET_EXCEEDED' },
      });
    } finally {
      await c.close();
      await fresh.close();
      site.chapterCount = 3;
    }
  });

  it('tests a plugin step by step', async () => {
    const res = await data('test_plugin', { plugin: 'fixture' });
    expect(res.ok).toBe(true);
    expect(res.steps.map((s: { ok: boolean }) => s.ok)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('describes a source’s filters', async () => {
    const res = await data('popular_novels', {
      plugin: 'fixture',
      describe_filters: true,
    });
    expect(res.filters).toEqual([
      {
        key: 'order',
        label: 'Order',
        default: 'popular',
        accepts: 'one of: popular, new',
      },
    ]);
    const latest = await data('popular_novels', {
      plugin: 'fixture',
      latest: true,
      filters: { order: 'new' },
    });
    expect(latest.novels[0].name).toBe('Latest new 1');
  });

  it('serves the library and novels as resources', async () => {
    await data('follow_novel', { novel: 'fixture:novel/abc' });
    const { resources } = await client.listResources();
    expect(resources.map(r => r.uri)).toEqual([
      'lnreader://library',
      'lnreader://novel/fixture/novel/abc',
    ]);
    const novel = await client.readResource({
      uri: 'lnreader://novel/fixture/novel/abc',
    });
    const text = (novel.contents[0] as { text: string }).text;
    expect(JSON.parse(text)).toMatchObject({
      name: 'CLI Novel',
      followed: true,
    });
    const library = await client.readResource({ uri: 'lnreader://library' });
    expect(
      JSON.parse((library.contents[0] as { text: string }).text),
    ).toHaveLength(1);
  });

  it('never returns cookies, User-Agents or plugin settings', async () => {
    const everything = JSON.stringify([
      await data('list_plugins'),
      await data('get_novel', { novel: 'fixture:novel/abc' }),
      await data('list_library'),
    ]);
    expect(everything).not.toMatch(/cookie|user-?agent|apiKey|Mozilla/i);
  });
});
