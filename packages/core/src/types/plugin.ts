/*
 * Vendored from LNReader/lnreader-plugins (src/types/plugin.ts).
 * Copyright (c) LNReader contributors, MIT License.
 */
import type { Filters, FilterValues } from './filters.js';

// Kept as a namespace to match upstream's `Plugin.*` type names.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Plugin {
  export type ChapterItem = {
    name: string;
    path: string;
    /** "YYYY-MM-DD", ISO string, or free text. */
    releaseTime?: string | null;
    chapterNumber?: number;
    /** Only for novels without pages. */
    page?: string;
    scanlator?: string | string[];
  };

  export type NovelItem = {
    name: string;
    path: string;
    cover?: string;
  };

  export type SourceNovel = {
    /** Comma separated genre list, e.g. "action,fantasy,romance". */
    genres?: string;
    summary?: string;
    author?: string;
    artist?: string;
    status?: string;
    /** Rating out of 5. */
    rating?: number;
    chapters?: ChapterItem[];
  } & NovelItem;

  export type SourcePage = {
    chapters: ChapterItem[];
  };

  export type PopularNovelsOptions = {
    showLatestNovels?: boolean;
    filters?: FilterValues;
  };

  export type ImageRequestInit = {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };

  export type PluginBase = {
    id: string;
    name: string;
    icon: string;
    customJS?: string;
    customCSS?: string;
    site: string;
    imageRequestInit?: ImageRequestInit;
    filters?: Filters;
    version: string;
    webStorageUtilized?: boolean;
    pluginSettings?: Record<
      string,
      { value: unknown; label: string; type?: string }
    >;
    popularNovels(
      pageNo: number,
      options: PopularNovelsOptions,
    ): Promise<NovelItem[]>;
    parseNovel(
      novelPath: string,
    ): Promise<SourceNovel & { totalPages?: number }>;
    parsePage?(novelPath: string, page: string): Promise<SourcePage>;
    parseChapter(chapterPath: string): Promise<string>;
    searchNovels(searchTerm: string, pageNo: number): Promise<NovelItem[]>;
    resolveUrl?(path: string, isNovel?: boolean): string;
  };
}
