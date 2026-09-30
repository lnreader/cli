import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CookieJar } from 'tough-cookie';
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/net/client.js';
import {
  InvalidPluginError,
  PluginError,
  UnshimmedImportError,
} from '../src/plugins/errors.js';
import { callPlugin, loadPlugin } from '../src/plugins/sandbox.js';
import { fixtureCode, fixtureRunner, novelSite, tempHome } from './helpers.js';

const deps = async () => ({
  http: new HttpClient({
    concurrency: 1,
    minGapMs: 0,
    userAgent: 'ua',
    fetch: async () => new Response(''),
  }),
  jar: new CookieJar(),
  storageFile: join(await tempHome(), 'storage.json'),
});

describe('sandbox', () => {
  it('runs a compiled plugin against the shims', async () => {
    const site = novelSite();
    const { runner } = await fixtureRunner(site.fetch, await tempHome());
    const results = await runner.searchNovels('hello world');
    expect(results).toEqual([
      {
        name: 'Result for hello world',
        path: 'novel/abc',
        cover: 'https://novels.test/cover.png',
      },
    ]);
    const novel = await runner.parseNovel('novel/abc');
    expect(novel.name).toBe('The Test Novel');
    expect(novel.status).toBe('Ongoing');
    expect(novel.chapters).toHaveLength(5);
    expect(novel.chapters[0]!.releaseTime).toMatch(/^2024-01-01/);
    expect(await runner.parseChapter('novel/abc/1')).toContain(
      'Text of chapter 1',
    );
  });

  it('passes default filter values to popularNovels', async () => {
    const { runner } = await fixtureRunner(novelSite().fetch, await tempHome());
    expect(await runner.popularNovels(2)).toEqual([
      { name: 'Popular popular 2', path: 'novel/abc' },
    ]);
  });

  it('hides process, Buffer and real require from plugins', async () => {
    const plugin = loadPlugin(await fixtureCode(), 'fixture', await deps());
    expect((plugin as unknown as { probe(): object }).probe()).toEqual({
      process: 'undefined',
      require: 'function',
      buffer: 'undefined',
    });
    const d = await deps();
    const code = `module.exports.default = require('fs');`;
    expect(() => loadPlugin(code, 'evil', d)).toThrow(UnshimmedImportError);
  });

  it('names the plugin and module in unshimmed import errors', async () => {
    const d = await deps();
    const code = `require('@libs/somethingNew');`;
    expect(() => loadPlugin(code, 'newplugin', d)).toThrow(
      'Unshimmed import: @libs/somethingNew (plugin newplugin)',
    );
  });

  it('rejects modules that are not plugins', async () => {
    const d = await deps();
    expect(() => loadPlugin(`exports.default = { id: 'x' }`, 'x', d)).toThrow(
      InvalidPluginError,
    );
  });

  it('times out runaway top-level code', async () => {
    const d = { ...(await deps()), loadTimeoutMs: 50 };
    expect(() => loadPlugin('while (true) {}', 'spin', d)).toThrow(/timed out/);
  });

  it('persists plugin storage across loads', async () => {
    const d = await deps();
    const code = await fixtureCode();
    loadPlugin(code, 'fixture', d);
    const second = loadPlugin(code, 'fixture', d) as unknown as {
      loads: number;
    };
    expect(second.loads).toBe(2);
    const stored = JSON.parse(await readFile(d.storageFile, 'utf8'));
    expect(stored.loads.value).toBe(2);
  });

  it('times out slow async calls and wraps errors with the plugin id', async () => {
    const plugin = loadPlugin(await fixtureCode(), 'fixture', await deps());
    await expect(
      callPlugin(plugin, 'slow', 30, () => new Promise(() => {})),
    ).rejects.toThrow(/fixture\.slow failed: timed out/);
    await expect(
      callPlugin(plugin, 'boom', 1000, async () => {
        throw new Error('bad html');
      }),
    ).rejects.toBeInstanceOf(PluginError);
  });
});
