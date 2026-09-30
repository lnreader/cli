import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ChapterCache } from '../src/store/cache.js';
import { Library } from '../src/store/library.js';
import { resolvePaths } from '../src/store/paths.js';
import { updateNovel } from '../src/update.js';
import { fixtureRunner, novelSite, tempHome } from './helpers.js';

/** A library, cache and output dir shared across runs against a growing site. */
async function setup() {
  const home = await tempHome();
  const paths = resolvePaths(home);
  const library = Library.open(paths);
  const cache = new ChapterCache(paths);
  const out = join(home, 'out');
  const run = async (
    chapters: number,
    opts: { delta?: boolean; split?: number } = {},
  ) => {
    const site = novelSite(chapters);
    const { runner, http, jar } = await fixtureRunner(site.fetch, home);
    const novel =
      library.get('fixture', 'novel/abc') ??
      library.follow(
        'fixture',
        'novel/abc',
        { name: 'The Test Novel' },
        { outDir: out, split: opts.split, noImages: true },
      );
    const result = await updateNovel({
      library,
      novel,
      runner,
      cache,
      http,
      jar,
      delta: opts.delta,
      sleep: async () => {},
    });
    return { result, site };
  };
  return { library, run, out };
}

describe('Library', () => {
  it('follows, lists and unfollows novels', async () => {
    const library = Library.open(resolvePaths(await tempHome()));
    const a = library.follow('p', 'b-path', { name: 'Beta' }, { outDir: '/x' });
    library.follow(
      'p',
      'a-path',
      { name: 'alpha' },
      { outDir: '/x', split: 50 },
    );
    expect(library.list().map(n => n.name)).toEqual(['alpha', 'Beta']);
    expect(library.get('p', 'a-path')?.options).toEqual({
      outDir: '/x',
      split: 50,
    });

    library.recordDelivered(
      a.id,
      [{ path: 'c1', name: 'One', position: 1 }],
      ['/x/Beta.epub'],
      'full',
    );
    // Re-following keeps delivered chapters.
    library.follow('p', 'b-path', { name: 'Beta' }, { outDir: '/y' });
    expect(library.get('p', 'b-path')).toMatchObject({
      knownCount: 1,
      options: { outDir: '/y' },
    });
    expect(library.outputs(a.id)).toEqual([
      expect.objectContaining({ file: '/x/Beta.epub', kind: 'full' }),
    ]);

    library.unfollow(a.id);
    expect(library.list().map(n => n.name)).toEqual(['alpha']);
    library.close();
  });
});

describe('updateNovel', () => {
  it('delivers everything first, then only new chapters', async () => {
    const { run, library, out } = await setup();
    const first = await run(3);
    expect(first.result).toMatchObject({
      status: 'updated',
      added: [1, 2, 3],
      failed: [],
    });
    expect(await readdir(out)).toEqual(['The Test Novel.epub']);

    const again = await run(3);
    expect(again.result).toEqual({ status: 'up-to-date', total: 3 });

    const grown = await run(5);
    expect(grown.result).toMatchObject({ status: 'updated', added: [4, 5] });
    // Only the two new chapters were fetched from the site.
    expect(
      grown.site.calls.filter(c => /\/novel\/abc\/\d/.test(c.url)),
    ).toHaveLength(2);
    expect(library.get('fixture', 'novel/abc')).toMatchObject({
      knownCount: 5,
      totalCount: 5,
    });
  });

  it('writes a separate book for --delta', async () => {
    const { run, out } = await setup();
    await run(2);
    const delta = await run(4, { delta: true });
    expect(delta.result).toMatchObject({ status: 'updated', added: [3, 4] });
    expect((await readdir(out)).sort()).toEqual([
      'The Test Novel - New Chapters (Ch 3-4).epub',
      'The Test Novel.epub',
    ]);
  });

  it('rebuilds only volumes from the first new chapter when split', async () => {
    const { run, out } = await setup();
    await run(4, { split: 2 });
    expect((await readdir(out)).sort()).toEqual([
      'The Test Novel - Vol 01 (Ch 1-2).epub',
      'The Test Novel - Vol 02 (Ch 3-4).epub',
    ]);
    const grown = await run(5, { split: 2 });
    expect(grown.result).toMatchObject({
      files: [join(out, 'The Test Novel - Vol 03 (Ch 5-5).epub')],
    });
  });
});
