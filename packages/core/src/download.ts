import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CookieJar } from 'tough-cookie';
import {
  buildEpub,
  ImageCollector,
  stableUuid,
  type BookChapter,
} from './epub/build.js';
import { generateCover, sniffImage } from './epub/images.js';
import { toLanguageTag } from './epub/lang.js';
import { sanitizeChapter } from './epub/sanitize.js';
import { DEFAULT_CSS } from './epub/styles.js';
import { LnreaderError } from './errors.js';
import type { FetchBudget } from './net/budget.js';
import type { HttpClient } from './net/client.js';
import { hostOf } from './plugins/registry.js';
import type { PluginRunner } from './plugins/loader.js';
import type { ChapterCache } from './store/cache.js';
import { writeFileAtomic } from './store/fs.js';
import { defaultCover } from './types/constants.js';
import type { Plugin } from './types/plugin.js';

export type DownloadEvent =
  | {
      type: 'novel';
      novel: Plugin.SourceNovel;
      total: number;
      selected: number;
      fromCache: boolean;
    }
  | { type: 'page'; page: number; total: number }
  | {
      type: 'chapter';
      done: number;
      total: number;
      cached: boolean;
      chapter: Plugin.ChapterItem;
    }
  | {
      type: 'chapter-failed';
      chapter: Plugin.ChapterItem;
      index: number;
      error: Error;
    }
  | { type: 'building'; file: string; chapters: number }
  | { type: 'written'; file: string; bytes: number };

export type DownloadOptions = {
  runner: PluginRunner;
  novelPath: string;
  cache: ChapterCache;
  http: HttpClient;
  jar: CookieJar;
  /** 1-based, inclusive. */
  from?: number;
  to?: number;
  /** Chapters per volume; 0 or undefined means one file. */
  split?: number;
  noImages?: boolean;
  /** Output directory, or a `.epub` path for a single file. */
  out: string;
  /** Path to a CSS file replacing the default stylesheet. */
  cssFile?: string;
  /** Plugin calls in flight; the per-host limiter still applies underneath. */
  concurrency?: number;
  /** Retries per chapter after the first attempt. */
  retries?: number;
  /** Use only cached data: no metadata refresh, no chapter fetches. */
  offline?: boolean;
  /**
   * Build a "new chapters" book from only these chapter paths (within the
   * range), named `Title - New Chapters (Ch a-b)`. Ignores `split`.
   */
  delta?: string[];
  /** Per-host cap on uncached chapter fetches (agent sessions). */
  budget?: FetchBudget;
  /** Metadata already fetched this run (e.g. by an interactive picker); skips `parseNovel`. */
  prefetched?: Plugin.SourceNovel & { chapters: Plugin.ChapterItem[] };
  onEvent?: (event: DownloadEvent) => void;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
};

export type DownloadResult = {
  novel: Plugin.SourceNovel;
  /** The novel's full chapter list as fetched (or cached) this run. */
  allChapters: Plugin.ChapterItem[];
  files: string[];
  failed: Array<{ index: number; chapter: Plugin.ChapterItem; error: string }>;
  chapters: number;
};

export function safeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'novel').slice(0, 150).replace(/[. ]+$/, '');
}

const pad = (n: number) => String(n).padStart(2, '0');

function hasContent(html: string): boolean {
  return (
    /<img\b/i.test(html) ||
    html.replace(/<[^>]*>/g, '').replace(/&nbsp;|\s/g, '').length > 0
  );
}

const defaultSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Download (or read from cache) a novel's chapters and write one or more EPUBs. */
export async function downloadNovel(
  opts: DownloadOptions,
): Promise<DownloadResult> {
  const { runner, novelPath, cache, onEvent } = opts;
  const pluginId = runner.id;
  const sleep = opts.sleep ?? defaultSleep;

  // 1. Metadata and chapter list: fresh when possible, cached otherwise.
  let novel: Plugin.SourceNovel;
  let chapters: Plugin.ChapterItem[];
  let fromCache = false;
  const cached = await cache.getNovel(pluginId, novelPath);
  if (opts.offline) {
    if (!cached)
      throw new LnreaderError(
        'NOT_CACHED',
        'No cached copy of this novel',
        'Run once without --offline',
      );
    ({ novel, chapters } = cached);
    fromCache = true;
  } else {
    try {
      const parsed =
        opts.prefetched ??
        (await runner.parseNovel(novelPath, (page, total) =>
          onEvent?.({ type: 'page', page, total }),
        ));
      ({ chapters, ...novel } = parsed);
      await cache.setNovel(
        {
          pluginId,
          pluginVersion: runner.entry.version,
          novel,
          chapters,
          fetchedAt: new Date().toISOString(),
        },
        novelPath,
      );
    } catch (err) {
      if (!cached) throw err;
      ({ novel, chapters } = cached);
      fromCache = true;
    }
  }
  if (chapters.length === 0)
    throw new LnreaderError(
      'NO_CHAPTERS',
      `No chapters found for ${novel.name || novelPath}`,
    );

  const from = Math.max(1, opts.from ?? 1);
  const to = Math.min(chapters.length, opts.to ?? chapters.length);
  if (from > to)
    throw new LnreaderError(
      'INVALID_INPUT',
      `Empty range: ${from}-${to} (novel has ${chapters.length} chapters)`,
    );
  const deltaPaths = opts.delta ? new Set(opts.delta) : undefined;
  const selected = chapters
    .slice(from - 1, to)
    .map((chapter, i) => ({ chapter, index: from + i }))
    .filter(({ chapter }) => !deltaPaths || deltaPaths.has(chapter.path));
  if (selected.length === 0) {
    return { novel, allChapters: chapters, files: [], failed: [], chapters: 0 };
  }
  onEvent?.({
    type: 'novel',
    novel,
    total: chapters.length,
    selected: selected.length,
    fromCache,
  });

  // 2. Chapters: cache first, then a small worker pool against the plugin.
  const bodies = new Map<number, string>();
  const failed: DownloadResult['failed'] = [];
  let done = 0;
  const queue = [...selected];
  const retries = opts.retries ?? 3;

  // Refuse up front rather than stopping halfway when the budget can't cover it.
  const budgetHost = hostOf(runner.plugin.site) ?? runner.id;
  if (opts.budget && !opts.offline) {
    let uncached = 0;
    for (const { chapter } of selected) {
      if (
        (await cache.getChapter(pluginId, novelPath, chapter.path)) ===
        undefined
      )
        uncached++;
    }
    await opts.budget.ensure(budgetHost, uncached);
  }

  const fetchOne = async ({ chapter, index }: (typeof selected)[number]) => {
    const hit = await cache.getChapter(pluginId, novelPath, chapter.path);
    if (hit !== undefined) {
      bodies.set(index, hit);
      onEvent?.({
        type: 'chapter',
        done: ++done,
        total: selected.length,
        cached: true,
        chapter,
      });
      return;
    }
    if (opts.offline) {
      const error = new Error('not cached');
      failed.push({ index, chapter, error: error.message });
      onEvent?.({ type: 'chapter-failed', chapter, index, error });
      return;
    }
    opts.budget?.take(budgetHost);
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (opts.signal?.aborted) throw opts.signal.reason;
      try {
        const html = await runner.parseChapter(chapter.path);
        if (!hasContent(html)) throw new Error('empty chapter');
        await cache.setChapter(pluginId, novelPath, chapter.path, html);
        bodies.set(index, html);
        onEvent?.({
          type: 'chapter',
          done: ++done,
          total: selected.length,
          cached: false,
          chapter,
        });
        return;
      } catch (err) {
        lastError = err as Error;
        if (attempt < retries) await sleep(1000 * 2 ** attempt);
      }
    }
    failed.push({
      index,
      chapter,
      error: lastError?.message ?? 'unknown error',
    });
    onEvent?.({
      type: 'chapter-failed',
      chapter,
      index,
      error: lastError ?? new Error('unknown'),
    });
  };

  const workers = Array.from(
    { length: Math.max(1, opts.concurrency ?? 4) },
    async () => {
      for (let next = queue.shift(); next; next = queue.shift())
        await fetchOne(next);
    },
  );
  await Promise.all(workers);
  failed.sort((a, b) => a.index - b.index);

  // 3. Build volumes.
  const css = opts.cssFile ? await readFile(opts.cssFile, 'utf8') : DEFAULT_CSS;
  const title = novel.name?.trim() || 'Untitled';
  const split = !deltaPaths && opts.split && opts.split > 0 ? opts.split : 0;
  const volumes = new Map<number, typeof selected>();
  for (const item of selected) {
    if (!bodies.has(item.index)) continue;
    const vol = split ? Math.floor((item.index - 1) / split) + 1 : 0;
    if (!volumes.has(vol)) volumes.set(vol, []);
    volumes.get(vol)!.push(item);
  }

  const fetchImage = makeImageFetcher(opts);
  const coverData = await fetchCover(novel, fetchImage);
  const novelUrl = runner.resolveUrl(novelPath, true);
  const files: string[] = [];

  for (const [vol, items] of volumes) {
    const first = items[0]!.index;
    const last = items[items.length - 1]!.index;
    const volTitle = deltaPaths
      ? `${title} - New Chapters (Ch ${first}-${last})`
      : vol
        ? `${title} - Vol ${pad(vol)} (Ch ${first}-${last})`
        : title;
    const file = outputPath(opts.out, volTitle, !!split);
    onEvent?.({ type: 'building', file, chapters: items.length });

    const images = new ImageCollector();
    const resolveImage = opts.noImages
      ? undefined
      : async (url: string) => {
          const data = await fetchImage(url);
          return data ? images.add(data) : undefined;
        };
    const bookChapters: BookChapter[] = [];
    for (const { chapter, index } of items) {
      const name = chapter.name?.trim() || `Chapter ${index}`;
      const { body } = await sanitizeChapter(bodies.get(index)!, {
        baseUrl: runner.resolveUrl(chapter.path, false),
        title: name,
        noImages: opts.noImages,
        resolveImage,
      });
      bookChapters.push({ title: name, body });
    }

    const authors = splitPeople(novel.author);
    const bytes = await buildEpub({
      metadata: {
        identifier: stableUuid(
          `lnreader:${pluginId}:${novelPath}:${deltaPaths ? `delta:${first}-${last}` : vol}`,
        ),
        title: volTitle,
        lang: toLanguageTag(runner.entry.lang),
        authors,
        artists: splitPeople(novel.artist),
        subjects: (novel.genres ?? '')
          .split(',')
          .map(g => g.trim())
          .filter(Boolean),
        description: novel.summary?.trim() || undefined,
        status: novel.status || undefined,
        source: novelUrl,
        publisher: runner.entry.name,
        generator: `${pluginId}@${runner.entry.version}`,
        series: vol ? { name: title, position: vol } : undefined,
        modified: new Date(),
      },
      css,
      cover:
        vol && !coverData.real
          ? generateCover(title, authors[0], `Volume ${vol}`)
          : coverData.data,
      titlePage: {
        title: volTitle,
        author: authors.join(', ') || undefined,
        summary: novel.summary,
        details: [
          ['Status', novel.status ?? ''],
          ['Genres', novel.genres ?? ''],
          ['Chapters', `${first}-${last} of ${chapters.length}`],
          ['Source', novelUrl],
          [
            'Plugin',
            `${runner.entry.name} (${pluginId}@${runner.entry.version})`,
          ],
        ].filter((d): d is [string, string] => !!d[1]),
      },
      chapters: bookChapters,
      images,
    });
    await writeFileAtomic(file, bytes);
    files.push(file);
    onEvent?.({ type: 'written', file, bytes: bytes.length });
  }

  return {
    novel,
    allChapters: chapters,
    files,
    failed,
    chapters: selected.length - failed.length,
  };
}

function splitPeople(s: string | undefined): string[] {
  return (s ?? '')
    .split(/\s*[,;&]\s*/)
    .map(p => p.trim())
    .filter(Boolean);
}

function outputPath(out: string, title: string, split: boolean): string {
  if (out.toLowerCase().endsWith('.epub')) {
    if (!split) return out;
    return join(dirname(out), `${safeFileName(title)}.epub`);
  }
  return join(out, `${safeFileName(title)}.epub`);
}

function makeImageFetcher(opts: DownloadOptions) {
  const { runner, cache, http, jar, novelPath } = opts;
  const init = runner.plugin.imageRequestInit;
  return async (url: string): Promise<Uint8Array | undefined> => {
    const hit = await cache.getAsset(runner.id, novelPath, url);
    if (hit) return hit.data;
    if (opts.offline) return undefined;
    try {
      const headers = new Headers(init?.headers);
      if (!headers.has('referer')) headers.set('referer', runner.plugin.site);
      headers.set(
        'accept',
        'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
      );
      const res = await http.request(
        url,
        { method: init?.method ?? 'GET', headers, body: init?.body },
        { jar, retries: 2, signal: opts.signal, userAgent: runner.userAgent },
      );
      if (!res.ok) return undefined;
      const data = new Uint8Array(await res.arrayBuffer());
      const type = sniffImage(data);
      if (!type) return undefined;
      await cache.setAsset(runner.id, novelPath, url, type.mediaType, data);
      return data;
    } catch {
      return undefined;
    }
  };
}

async function fetchCover(
  novel: Plugin.SourceNovel,
  fetchImage: (url: string) => Promise<Uint8Array | undefined>,
): Promise<{ data: Uint8Array; real: boolean }> {
  if (
    novel.cover &&
    novel.cover !== defaultCover &&
    /^https?:\/\//.test(novel.cover)
  ) {
    const data = await fetchImage(novel.cover);
    if (data) return { data, real: true };
  }
  return {
    data: generateCover(novel.name || 'Untitled', novel.author),
    real: false,
  };
}
