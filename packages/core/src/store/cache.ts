import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from '../types/plugin.js';
import { readJson, writeFileAtomic, writeJson } from './fs.js';
import type { Paths } from './paths.js';

const hash = (s: string) =>
  createHash('sha1').update(s).digest('hex').slice(0, 16);

/** Readable-but-safe directory name: a slug plus a hash for uniqueness. */
function key(s: string): string {
  const slug = s
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-40);
  return slug ? `${slug}-${hash(s)}` : hash(s);
}

export type CachedNovel = {
  pluginId: string;
  pluginVersion: string;
  novel: Plugin.SourceNovel;
  chapters: Plugin.ChapterItem[];
  fetchedAt: string;
};

/**
 * On-disk chapter cache keyed by plugin, novel path and chapter path.
 * Chapters are immutable once fetched; novel metadata is refreshed per run.
 */
export class ChapterCache {
  constructor(private readonly paths: Paths) {}

  novelDir(pluginId: string, novelPath: string): string {
    return join(this.paths.cache, 'novels', pluginId, key(novelPath));
  }

  private chapterFile(
    pluginId: string,
    novelPath: string,
    chapterPath: string,
  ): string {
    return join(
      this.novelDir(pluginId, novelPath),
      'chapters',
      `${hash(chapterPath)}.html`,
    );
  }

  async getChapter(pluginId: string, novelPath: string, chapterPath: string) {
    try {
      return await readFile(
        this.chapterFile(pluginId, novelPath, chapterPath),
        'utf8',
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async setChapter(
    pluginId: string,
    novelPath: string,
    chapterPath: string,
    html: string,
  ) {
    await writeFileAtomic(
      this.chapterFile(pluginId, novelPath, chapterPath),
      html,
    );
  }

  async getNovel(
    pluginId: string,
    novelPath: string,
  ): Promise<CachedNovel | undefined> {
    return readJson<CachedNovel>(
      join(this.novelDir(pluginId, novelPath), 'novel.json'),
    );
  }

  async setNovel(value: CachedNovel, novelPath: string): Promise<void> {
    await writeJson(
      join(this.novelDir(value.pluginId, novelPath), 'novel.json'),
      value,
    );
  }

  /** Binary assets (cover, inline images) keyed by URL. */
  private assetFile(pluginId: string, novelPath: string, url: string): string {
    return join(this.novelDir(pluginId, novelPath), 'assets', hash(url));
  }

  async getAsset(pluginId: string, novelPath: string, url: string) {
    const file = this.assetFile(pluginId, novelPath, url);
    const meta = await readJson<{ type: string }>(`${file}.json`);
    if (!meta) return undefined;
    try {
      return { type: meta.type, data: new Uint8Array(await readFile(file)) };
    } catch {
      return undefined;
    }
  }

  async setAsset(
    pluginId: string,
    novelPath: string,
    url: string,
    type: string,
    data: Uint8Array,
  ) {
    const file = this.assetFile(pluginId, novelPath, url);
    await writeFileAtomic(file, data);
    await writeJson(`${file}.json`, { type, url });
  }
}
