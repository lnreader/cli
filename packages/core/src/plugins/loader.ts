import { join } from 'node:path';
import type { HttpClient } from '../net/client.js';
import type { CookieStore } from '../net/cookies.js';
import type { Paths } from '../store/paths.js';
import type { FilterValues } from '../types/filters.js';
import type { Plugin } from '../types/plugin.js';
import type { PluginEntry, PluginRegistry } from './registry.js';
import { callPlugin, loadPlugin, type Logger } from './sandbox.js';

function asArray<T>(value: unknown, what: string): T[] {
  if (!Array.isArray(value)) throw new Error(`expected ${what} to be an array`);
  return value as T[];
}

function cleanItems(items: Plugin.NovelItem[]): Plugin.NovelItem[] {
  return items
    .filter(i => i && typeof i.path === 'string')
    .map(i => ({
      name: String(i.name ?? '').trim(),
      path: i.path,
      cover: i.cover || undefined,
    }));
}

/** A loaded plugin with timeouts, error wrapping and output checks around each call. */
export class PluginRunner {
  constructor(
    readonly entry: PluginEntry,
    readonly plugin: Plugin.PluginBase,
    private readonly timeoutMs: number,
  ) {}

  get id() {
    return this.plugin.id;
  }

  private call<T>(method: string, fn: () => Promise<T>): Promise<T> {
    if (!this.plugin.site) {
      const settings = Object.keys(this.plugin.pluginSettings ?? {}).join(', ');
      return Promise.reject(
        new Error(
          `Plugin ${this.id} needs its settings configured first (${settings})`,
        ),
      );
    }
    return callPlugin(this.plugin, method, this.timeoutMs, fn);
  }

  searchNovels(term: string, page = 1) {
    return this.call('searchNovels', async () =>
      cleanItems(
        asArray(await this.plugin.searchNovels(term, page), 'search results'),
      ),
    );
  }

  popularNovels(
    page = 1,
    options: { showLatestNovels?: boolean; filters?: FilterValues } = {},
  ) {
    const filters = options.filters ?? defaultFilterValues(this.plugin);
    return this.call('popularNovels', async () =>
      cleanItems(
        asArray(
          await this.plugin.popularNovels(page, {
            showLatestNovels: options.showLatestNovels,
            filters,
          }),
          'popular novels',
        ),
      ),
    );
  }

  /**
   * Novel metadata with the full chapter list. Paged plugins (`totalPages`)
   * have each page fetched through `parsePage`.
   */
  parseNovel(path: string, onPage?: (page: number, total: number) => void) {
    return this.call('parseNovel', async () => {
      const novel = await this.plugin.parseNovel(path);
      if (!novel || typeof novel !== 'object')
        throw new Error('parseNovel returned nothing');
      const chapters = asArray<Plugin.ChapterItem>(
        novel.chapters ?? [],
        'chapters',
      );
      const total = Number(novel.totalPages ?? 0);
      if (total > 0 && this.plugin.parsePage) {
        chapters.length = 0;
        for (let page = 1; page <= total; page++) {
          onPage?.(page, total);
          const result = await this.plugin.parsePage(path, String(page));
          chapters.push(
            ...asArray<Plugin.ChapterItem>(
              result?.chapters ?? [],
              'page chapters',
            ),
          );
        }
      }
      return {
        ...novel,
        path: novel.path || path,
        chapters: chapters.filter(c => c && typeof c.path === 'string'),
      } as Plugin.SourceNovel & { chapters: Plugin.ChapterItem[] };
    });
  }

  parseChapter(path: string) {
    return this.call('parseChapter', async () => {
      const html = await this.plugin.parseChapter(path);
      if (typeof html !== 'string')
        throw new Error('parseChapter did not return a string');
      return html;
    });
  }

  /** Absolute URL for a novel or chapter path, for display and metadata. */
  resolveUrl(path: string, isNovel = true): string {
    try {
      if (this.plugin.resolveUrl) return this.plugin.resolveUrl(path, isNovel);
    } catch {
      // Fall through to the generic join.
    }
    if (/^https?:\/\//.test(path)) return path;
    return new URL(
      path.replace(/^\/+/, ''),
      this.plugin.site.replace(/\/*$/, '/'),
    ).href;
  }
}

/** Default `{ type, value }` pairs from a plugin's declared filters. */
export function defaultFilterValues(
  plugin: Plugin.PluginBase,
): FilterValues | undefined {
  if (!plugin.filters) return undefined;
  return Object.fromEntries(
    Object.entries(plugin.filters).map(([k, f]) => [
      k,
      { type: f.type, value: f.value },
    ]),
  );
}

export type PluginLoaderOptions = {
  registry: PluginRegistry;
  http: HttpClient;
  cookies: CookieStore;
  paths: Paths;
  timeoutMs: number;
  logger?: Logger;
};

export class PluginLoader {
  private readonly loaded = new Map<string, Promise<PluginRunner>>();

  constructor(private readonly options: PluginLoaderOptions) {}

  load(id: string): Promise<PluginRunner> {
    let p = this.loaded.get(id);
    if (!p) {
      p = this.doLoad(id);
      this.loaded.set(id, p);
      p.catch(() => this.loaded.delete(id));
    }
    return p;
  }

  private async doLoad(id: string): Promise<PluginRunner> {
    const { registry, http, cookies, paths, timeoutMs, logger } = this.options;
    const entry = await registry.get(id);
    const code = await registry.getCode(entry);
    const plugin = loadPlugin(code, entry.id, {
      http,
      jar: await cookies.jar(entry.id),
      storageFile: join(paths.data, 'plugins', entry.id, 'storage.json'),
      logger,
    });
    return new PluginRunner(entry, plugin, timeoutMs);
  }
}
