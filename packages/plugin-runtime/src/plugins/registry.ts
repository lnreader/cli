import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { HttpClient } from '../net/client.js';
import { LnreaderError } from '../errors.js';
import { readJson, writeFileAtomic, writeJson } from '../store/fs.js';
import { BLACKLIST_URL } from '../store/config.js';
import type { Paths } from '../store/paths.js';

const INDEX_TTL_MS = 6 * 60 * 60 * 1000;

export const PluginEntrySchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  site: z.string(),
  lang: z.string(),
  version: z.string(),
  url: z.string(),
  iconUrl: z.string().optional(),
  customJS: z.string().optional(),
  customCSS: z.string().optional(),
});

export type PluginEntry = z.infer<typeof PluginEntrySchema> & {
  /** The repo index this entry came from. */
  repo: string;
};

export const BlacklistSchema = z.array(
  z.looseObject({
    name: z.string(),
    site: z.string(),
    lang: z.string().optional(),
    reason: z.string().optional(),
    aliases: z.array(z.string()).optional(),
  }),
);

export type Blacklist = z.infer<typeof BlacklistSchema>;

/** Snapshot of upstream BLACKLIST.json, used when the live copy is unreachable. */
export const BUNDLED_BLACKLIST: Blacklist = [
  {
    name: 'Novel Oku',
    site: 'https://novelokutr.net/',
    lang: 'Turkish',
    reason: 'Requested by Owner',
    aliases: ['novelokutr.net', 'www.novelokutr.net'],
  },
];

type CachedJson = { fetchedAt: number; url: string; data: unknown };

export type RegistryOptions = {
  http: HttpClient;
  paths: Paths;
  repos: string[];
  blacklistUrl?: string;
  now?: () => number;
};

/** Normalized host for matching: lowercase, no `www.`. */
export function hostOf(url: string): string | undefined {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

export function isBlacklisted(
  entry: { site: string; name: string },
  blacklist: Blacklist,
) {
  const host = hostOf(entry.site);
  return blacklist.some(b => {
    const hosts = [b.site, ...(b.aliases ?? [])].map(hostOf);
    return (host && hosts.includes(host)) || b.name === entry.name;
  });
}

/** Loads plugin indexes from repos, applies the blacklist and caches plugin code. */
export class PluginRegistry {
  private entries?: PluginEntry[];
  private blacklist?: Blacklist;
  private readonly now: () => number;

  constructor(private readonly options: RegistryOptions) {
    this.now = options.now ?? Date.now;
  }

  private cacheFile(kind: string, url: string): string {
    const h = createHash('sha1').update(url).digest('hex').slice(0, 16);
    return join(this.options.paths.cache, kind, `${h}.json`);
  }

  /** Fetch JSON with a TTL cache; falls back to a stale copy when offline. */
  private async fetchJson(
    kind: string,
    url: string,
    refresh: boolean,
  ): Promise<unknown> {
    const file = this.cacheFile(kind, url);
    const cached = await readJson<CachedJson>(file);
    if (cached && !refresh && this.now() - cached.fetchedAt < INDEX_TTL_MS)
      return cached.data;
    try {
      const res = await this.options.http.request(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      await writeJson(file, {
        fetchedAt: this.now(),
        url,
        data,
      } satisfies CachedJson);
      return data;
    } catch (err) {
      if (cached) return cached.data;
      throw new Error(`Could not fetch ${url}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  async getBlacklist(refresh = false): Promise<Blacklist> {
    if (this.blacklist && !refresh) return this.blacklist;
    try {
      this.blacklist = BlacklistSchema.parse(
        await this.fetchJson(
          'blacklist',
          this.options.blacklistUrl ?? BLACKLIST_URL,
          refresh,
        ),
      );
    } catch {
      this.blacklist = BUNDLED_BLACKLIST;
    }
    return this.blacklist;
  }

  /** All non-blacklisted plugins. On duplicate ids the first repo wins. */
  async list(refresh = false): Promise<PluginEntry[]> {
    if (this.entries && !refresh) return this.entries;
    const blacklist = await this.getBlacklist(refresh);
    const seen = new Map<string, PluginEntry>();
    for (const repo of this.options.repos) {
      const raw = await this.fetchJson('repos', repo, refresh);
      const parsed = z.array(z.unknown()).parse(raw);
      for (const item of parsed) {
        const entry = PluginEntrySchema.safeParse(item);
        if (!entry.success || seen.has(entry.data.id)) continue;
        if (isBlacklisted(entry.data, blacklist)) continue;
        seen.set(entry.data.id, { ...entry.data, repo });
      }
    }
    this.entries = [...seen.values()];
    return this.entries;
  }

  async get(id: string): Promise<PluginEntry> {
    const entries = await this.list();
    const entry =
      entries.find(e => e.id === id) ??
      entries.find(e => e.id.toLowerCase() === id.toLowerCase());
    if (entry) return entry;
    const blacklist = await this.getBlacklist();
    if (blacklist.some(b => b.name.toLowerCase() === id.toLowerCase())) {
      throw new LnreaderError(
        'PLUGIN_NOT_FOUND',
        `Plugin ${id} is blacklisted and cannot be used`,
      );
    }
    throw new LnreaderError(
      'PLUGIN_NOT_FOUND',
      `Unknown plugin: ${id}`,
      'List plugin ids with `lnreader plugins list`',
    );
  }

  /** Find the plugin whose `site` host matches the URL, and the path relative to it. */
  async resolveUrl(
    url: string,
  ): Promise<{ entry: PluginEntry; path: string } | undefined> {
    const host = hostOf(url);
    if (!host) return undefined;
    const blacklist = await this.getBlacklist();
    if (isBlacklisted({ site: url, name: '' }, blacklist)) {
      throw new LnreaderError(
        'PLUGIN_NOT_FOUND',
        `${host} is blacklisted and cannot be used`,
      );
    }
    const matches = (await this.list()).filter(e => hostOf(e.site) === host);
    if (matches.length === 0) return undefined;
    const target = new URL(url);
    // Prefer the plugin whose site path is the longest prefix of the URL path.
    const scored = matches
      .map(entry => {
        const sitePath = new URL(entry.site).pathname.replace(/\/+$/, '');
        const ok = target.pathname.startsWith(sitePath);
        return { entry, sitePath, score: ok ? sitePath.length : -1 };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0]!;
    const rest = target.pathname
      .slice(Math.max(best.score, 0))
      .replace(/^\/+/, '');
    return { entry: best.entry, path: rest + target.search };
  }

  /** Compiled plugin JS, cached by `id@version`. */
  async getCode(entry: PluginEntry): Promise<string> {
    const file = join(
      this.options.paths.cache,
      'plugins',
      `${entry.id}@${entry.version}.js`,
    );
    try {
      return await readFile(file, 'utf8');
    } catch {
      // Not cached yet.
    }
    const res = await this.options.http.request(entry.url);
    if (!res.ok)
      throw new Error(
        `Could not download plugin ${entry.id}: HTTP ${res.status}`,
      );
    const code = await res.text();
    await writeFileAtomic(file, code);
    return code;
  }
}
