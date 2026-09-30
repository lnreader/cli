import type { CookieJar } from 'tough-cookie';
import {
  downloadNovel,
  type DownloadEvent,
  type DownloadResult,
} from './download.js';
import type { HttpClient } from './net/client.js';
import type { PluginRunner } from './plugins/loader.js';
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
    out: options.outDir,
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
