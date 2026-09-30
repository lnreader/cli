import { LnreaderError } from '../errors.js';
import type { FetchBudget } from '../net/budget.js';
import type { PluginRunner } from '../plugins/loader.js';
import { hostOf } from '../plugins/registry.js';
import type { ChapterCache } from '../store/cache.js';
import type { Plugin } from '../types/plugin.js';
import { renderChapter, sliceContent, type ReadFormat } from './format.js';

export type LoadedNovel = {
  novel: Plugin.SourceNovel;
  chapters: Plugin.ChapterItem[];
  fromCache: boolean;
  fetchedAt: string;
};

/**
 * Novel metadata and chapter list, from the cache when it is younger than
 * `maxAgeMs` (or `offline`), otherwise fetched and cached. A failed fetch
 * falls back to any cached copy.
 */
export async function loadNovel(opts: {
  runner: PluginRunner;
  novelPath: string;
  cache: ChapterCache;
  maxAgeMs?: number;
  offline?: boolean;
}): Promise<LoadedNovel> {
  const { runner, novelPath, cache } = opts;
  const cached = await cache.getNovel(runner.id, novelPath);
  const age = cached ? Date.now() - Date.parse(cached.fetchedAt) : Infinity;
  if (cached && (opts.offline || age < (opts.maxAgeMs ?? 0))) {
    return {
      novel: cached.novel,
      chapters: cached.chapters,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
    };
  }
  if (opts.offline)
    throw new LnreaderError(
      'NOT_CACHED',
      'No cached copy of this novel',
      'Run once without --offline',
    );
  try {
    const { chapters, ...novel } = await runner.parseNovel(novelPath);
    const fetchedAt = new Date().toISOString();
    await cache.setNovel(
      {
        pluginId: runner.id,
        pluginVersion: runner.entry.version,
        novel,
        chapters,
        fetchedAt,
      },
      novelPath,
    );
    return { novel, chapters, fromCache: false, fetchedAt };
  } catch (err) {
    if (!cached) throw err;
    return {
      novel: cached.novel,
      chapters: cached.chapters,
      fromCache: true,
      fetchedAt: cached.fetchedAt,
    };
  }
}

export type ChapterRef = number | string;

/** A chapter and its 1-based position in the novel's chapter list. */
export type FoundChapter = { chapter: Plugin.ChapterItem; index: number };

const NUMBER_IN_NAME =
  /(?:chapter|chap\.?|ch\.?|episode|ep\.?|第)\s*(\d+(?:\.\d+)?)/i;

function chapterNumber(c: Plugin.ChapterItem): number | undefined {
  if (typeof c.chapterNumber === 'number') return c.chapterNumber;
  const m = c.name?.match(NUMBER_IN_NAME);
  return m ? Number(m[1]) : undefined;
}

/**
 * Find a chapter by what `info` or `get_novel` showed:
 * - `42` (or the number 42): 1-based index in the chapter list
 * - `ch:42` / `ch42`: chapter number, from the plugin or the chapter's name
 * - anything else: the chapter's path or full URL (`path:` forces this)
 */
export function findChapter(
  chapters: Plugin.ChapterItem[],
  ref: ChapterRef,
  resolveUrl?: (path: string) => string,
): FoundChapter {
  const total = chapters.length;
  const byIndex = (n: number): FoundChapter => {
    const chapter = chapters[n - 1];
    if (!Number.isInteger(n) || !chapter)
      throw new LnreaderError(
        'CHAPTER_NOT_FOUND',
        `No chapter #${n}; the novel has ${total} chapters`,
        'Chapter indexes are 1-based positions in the chapter list',
      );
    return { chapter, index: n };
  };
  if (typeof ref === 'number') return byIndex(ref);

  const input = ref.trim();
  if (/^\d+$/.test(input)) return byIndex(Number(input));

  const num = input.match(/^ch(?:apter)?:?\s*(\d+(?:\.\d+)?)$/i);
  if (num) {
    const want = Number(num[1]);
    const i = chapters.findIndex(c => chapterNumber(c) === want);
    if (i < 0)
      throw new LnreaderError(
        'CHAPTER_NOT_FOUND',
        `No chapter numbered ${want}`,
        'Use a 1-based index or a chapter path instead',
      );
    return { chapter: chapters[i]!, index: i + 1 };
  }

  const path = input.replace(/^path:/, '');
  const stripped = path.replace(/^\/+/, '');
  let i = chapters.findIndex(
    c => c.path === path || c.path.replace(/^\/+/, '') === stripped,
  );
  if (i < 0 && /^https?:\/\//i.test(path) && resolveUrl) {
    i = chapters.findIndex(c => {
      try {
        return resolveUrl(c.path) === path;
      } catch {
        return false;
      }
    });
  }
  if (i < 0)
    throw new LnreaderError(
      'CHAPTER_NOT_FOUND',
      `No chapter with path "${path}"`,
      'Use a 1-based index, `ch:<number>` or a path from the chapter list',
    );
  return { chapter: chapters[i]!, index: i + 1 };
}

/**
 * Load a novel (cached list when younger than `maxAgeMs`) and find a chapter
 * in it. A chapter missing from a cached list triggers one fresh fetch, since
 * it may simply be new.
 */
export async function locateChapter(opts: {
  runner: PluginRunner;
  novelPath: string;
  cache: ChapterCache;
  ref: ChapterRef;
  maxAgeMs?: number;
  offline?: boolean;
}): Promise<{ loaded: LoadedNovel; found: FoundChapter }> {
  const resolve = (p: string) => opts.runner.resolveUrl(p, false);
  const loaded = await loadNovel(opts);
  try {
    return { loaded, found: findChapter(loaded.chapters, opts.ref, resolve) };
  } catch (err) {
    if (!loaded.fromCache || opts.offline) throw err;
    const fresh = await loadNovel({ ...opts, maxAgeMs: 0 });
    return {
      loaded: fresh,
      found: findChapter(fresh.chapters, opts.ref, resolve),
    };
  }
}

export type ReadChapterResult = {
  chapter: Plugin.ChapterItem;
  index: number;
  format: ReadFormat;
  content: string;
  offset: number;
  nextOffset?: number;
  totalChars: number;
  /** True when the chapter came from the cache, with no request made. */
  cached: boolean;
};

/**
 * One chapter as Markdown, plain text, numbered paragraphs or sanitized
 * HTML, optionally as a chunk. Uncached fetches count against `budget`;
 * the fetched chapter is cached for next time.
 */
export async function readChapter(opts: {
  runner: PluginRunner;
  novelPath: string;
  cache: ChapterCache;
  found: FoundChapter;
  format?: ReadFormat;
  offset?: number;
  maxChars?: number;
  budget?: FetchBudget;
  offline?: boolean;
}): Promise<ReadChapterResult> {
  const { runner, novelPath, cache, found } = opts;
  const { chapter, index } = found;
  let html = await cache.getChapter(runner.id, novelPath, chapter.path);
  const cached = html !== undefined;
  if (html === undefined) {
    if (opts.offline)
      throw new LnreaderError(
        'NOT_CACHED',
        `Chapter ${index} is not cached`,
        'Run without --offline to fetch it',
      );
    const host = hostOf(runner.plugin.site) ?? runner.id;
    await opts.budget?.ensure(host);
    opts.budget?.take(host);
    html = await runner.parseChapter(chapter.path);
    // An empty page is usually a hiccup; leave it uncached so it's retried.
    if (/<img\b/i.test(html) || html.replace(/<[^>]*>|&nbsp;|\s/g, ''))
      await cache.setChapter(runner.id, novelPath, chapter.path, html);
  }
  const format = opts.format ?? 'md';
  const content = await renderChapter(html, {
    title: chapter.name?.trim() || `Chapter ${index}`,
    baseUrl: runner.resolveUrl(chapter.path, false),
    format,
  });
  const slice = sliceContent(content, opts.offset ?? 0, opts.maxChars);
  return {
    chapter,
    index,
    format,
    content: slice.text,
    offset: slice.offset,
    nextOffset: slice.nextOffset,
    totalChars: slice.totalChars,
    cached,
  };
}
