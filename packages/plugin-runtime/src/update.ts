import type { CookieJar } from 'tough-cookie';
import {
  downloadNovel,
  type DownloadEvent,
  type DownloadResult,
} from './download.js';
import { errorInfo } from './errors.js';
import type { FetchBudget } from './net/budget.js';
import type { HttpClient } from './net/client.js';
import type { PluginRunner } from './plugins/loader.js';
import { hostOf } from './plugins/registry.js';
import type { ChapterCache } from './store/cache.js';
import type { Library, LibraryNovel } from './store/library.js';

export type UpdateOptions = {
  library: Library;
  novel: LibraryNovel;
  runner: PluginRunner;
  cache: ChapterCache;
  http: HttpClient;
  jar: CookieJar;
  /** Write only the new chapters to a separate book instead of rebuilding. */
  delta?: boolean;
  /** Metadata already fetched this run; skips a second `parseNovel`. */
  prefetched?: Awaited<ReturnType<PluginRunner['parseNovel']>>;
  /** Write here instead of the novel's own output folder. */
  outDir?: string;
  budget?: FetchBudget;
  onEvent?: (event: DownloadEvent) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

export type UpdateResult =
  | { status: 'up-to-date'; total: number }
  | {
      status: 'updated';
      total: number;
      /** New chapters found this run (1-based positions). */
      added: number[];
      files: string[];
      failed: DownloadResult['failed'];
    };

/**
 * Check a followed novel for chapters not yet delivered. By default the full
 * book is rebuilt (only volumes from the first new chapter onward when split);
 * with `delta`, only the new chapters go into a separate book.
 */
export async function updateNovel(opts: UpdateOptions): Promise<UpdateResult> {
  const { library, novel, runner } = opts;
  const parsed = opts.prefetched ?? (await runner.parseNovel(novel.path));
  library.recordCheck(novel.id, parsed, parsed.chapters.length);

  const known = library.knownPaths(novel.id);
  const fresh = parsed.chapters
    .map((chapter, i) => ({ chapter, index: i + 1 }))
    .filter(({ chapter }) => !known.has(chapter.path));
  if (fresh.length === 0)
    return { status: 'up-to-date', total: parsed.chapters.length };

  const { options } = novel;
  const split = options.split && options.split > 0 ? options.split : undefined;
  const firstNew = fresh[0]!.index;
  const from =
    !opts.delta && split
      ? Math.floor((firstNew - 1) / split) * split + 1
      : undefined;

  const result = await downloadNovel({
    runner,
    novelPath: novel.path,
    cache: opts.cache,
    http: opts.http,
    jar: opts.jar,
    prefetched: parsed,
    out: opts.outDir ?? options.outDir,
    budget: opts.budget,
    split,
    from,
    noImages: options.noImages,
    cssFile: options.css,
    delta: opts.delta ? fresh.map(f => f.chapter.path) : undefined,
    onEvent: opts.onEvent,
    signal: opts.signal,
    sleep: opts.sleep,
  });

  // Chapters count as delivered once they are in a book; failed ones are retried next time.
  const failed = new Set(result.failed.map(f => f.chapter.path));
  const delivered = fresh
    .filter(({ chapter }) => !failed.has(chapter.path))
    .map(({ chapter, index }) => ({
      path: chapter.path,
      name: chapter.name,
      position: index,
    }));
  library.recordDelivered(
    novel.id,
    delivered,
    result.files,
    opts.delta ? 'delta' : 'full',
  );

  return {
    status: 'updated',
    total: parsed.chapters.length,
    added: fresh.map(f => f.index),
    files: result.files,
    failed: result.failed,
  };
}

export type CheckResult = {
  total: number;
  /** Chapters not yet delivered in a book, in list order. */
  fresh: Array<{ index: number; name: string; path: string }>;
  /** How many of `fresh` are now in the chapter cache. */
  cached: number;
  failed: Array<{ index: number; name: string; error: string }>;
};

/**
 * Check a followed novel for undelivered chapters and fetch them into the
 * cache, without writing any book. Delivery happens later, e.g. with a
 * delta download.
 */
export async function checkNovel(opts: {
  library: Library;
  novel: LibraryNovel;
  runner: PluginRunner;
  cache: ChapterCache;
  budget?: FetchBudget;
  signal?: AbortSignal;
}): Promise<CheckResult> {
  const { library, novel, runner, cache } = opts;
  const parsed = await runner.parseNovel(novel.path);
  const { chapters, ...meta } = parsed;
  await cache.setNovel(
    {
      pluginId: runner.id,
      pluginVersion: runner.entry.version,
      novel: meta,
      chapters,
      fetchedAt: new Date().toISOString(),
    },
    novel.path,
  );
  library.recordCheck(novel.id, parsed, chapters.length);
  const known = library.knownPaths(novel.id);
  const fresh = chapters
    .map((c, i) => ({ index: i + 1, name: c.name, path: c.path }))
    .filter(c => !known.has(c.path));

  const missing: typeof fresh = [];
  for (const c of fresh) {
    if ((await cache.getChapter(runner.id, novel.path, c.path)) === undefined)
      missing.push(c);
  }
  const host = hostOf(runner.plugin.site) ?? runner.id;
  await opts.budget?.ensure(host, missing.length);

  const failed: CheckResult['failed'] = [];
  for (const c of missing) {
    if (opts.signal?.aborted) throw opts.signal.reason;
    opts.budget?.take(host);
    try {
      const html = await runner.parseChapter(c.path);
      if (!html.replace(/<[^>]*>|&nbsp;|\s/g, '') && !/<img\b/i.test(html))
        throw new Error('empty chapter');
      await cache.setChapter(runner.id, novel.path, c.path, html);
    } catch (err) {
      // Every other chapter would hit the same bot check; stop here.
      if (errorInfo(err).code === 'NEEDS_AUTH') throw err;
      failed.push({
        index: c.index,
        name: c.name,
        error: (err as Error).message,
      });
    }
  }
  return {
    total: chapters.length,
    fresh,
    cached: fresh.length - failed.length,
    failed,
  };
}
