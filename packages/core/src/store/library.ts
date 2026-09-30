import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import type { Plugin } from '../types/plugin.js';
import type { Paths } from './paths.js';

const require = createRequire(import.meta.url);

/** Load `node:sqlite` without its one-time "experimental" warning. */
function loadSqlite(): typeof import('node:sqlite') {
  const original = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...rest: unknown[]) =>
    String((warning as Error)?.message ?? warning).includes('SQLite')
      ? undefined
      : (original as (...a: unknown[]) => void).call(
          process,
          warning,
          ...rest,
        )) as typeof process.emitWarning;
  try {
    return require('node:sqlite') as typeof import('node:sqlite');
  } finally {
    process.emitWarning = original;
  }
}

/** Download settings remembered per followed novel and reused by `update`. */
export type FollowOptions = {
  outDir: string;
  split?: number;
  noImages?: boolean;
  css?: string;
};

export type LibraryNovel = {
  id: number;
  pluginId: string;
  path: string;
  name: string;
  author?: string;
  cover?: string;
  url?: string;
  options: FollowOptions;
  followedAt: string;
  checkedAt?: string;
  updatedAt?: string;
  /** Chapters already delivered in a book. */
  knownCount: number;
  /** Chapters in the source's list at the last check. */
  totalCount: number;
};

export type LibraryOutput = {
  file: string;
  kind: 'full' | 'delta';
  builtAt: string;
};

type NovelRow = {
  id: number;
  plugin_id: string;
  path: string;
  name: string;
  author: string | null;
  cover: string | null;
  url: string | null;
  options: string;
  followed_at: string;
  checked_at: string | null;
  updated_at: string | null;
  known_count: number;
  total_count: number;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS novels (
  id INTEGER PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  url TEXT,
  options TEXT NOT NULL DEFAULT '{}',
  followed_at TEXT NOT NULL,
  checked_at TEXT,
  updated_at TEXT,
  total_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (plugin_id, path)
);
CREATE TABLE IF NOT EXISTS chapters (
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (novel_id, path)
);
CREATE TABLE IF NOT EXISTS outputs (
  novel_id INTEGER NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  kind TEXT NOT NULL,
  built_at TEXT NOT NULL,
  PRIMARY KEY (novel_id, file)
);
PRAGMA user_version = 1;
`;

const now = () => new Date().toISOString();

const SELECT_NOVELS = `
  SELECT n.*, (SELECT COUNT(*) FROM chapters c WHERE c.novel_id = n.id) AS known_count
  FROM novels n`;

/**
 * Followed novels, the chapters already delivered for each, and the files
 * written. Backed by `node:sqlite` in the data directory.
 */
export class Library {
  private readonly db: DatabaseSyncType;

  constructor(file: string) {
    const { DatabaseSync } = loadSqlite();
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  static open(paths: Paths): Library {
    mkdirSync(paths.data, { recursive: true });
    return new Library(join(paths.data, 'library.db'));
  }

  close(): void {
    this.db.close();
  }

  private toNovel(row: NovelRow): LibraryNovel {
    return {
      id: row.id,
      pluginId: row.plugin_id,
      path: row.path,
      name: row.name,
      author: row.author ?? undefined,
      cover: row.cover ?? undefined,
      url: row.url ?? undefined,
      options: JSON.parse(row.options) as FollowOptions,
      followedAt: row.followed_at,
      checkedAt: row.checked_at ?? undefined,
      updatedAt: row.updated_at ?? undefined,
      knownCount: row.known_count,
      totalCount: row.total_count,
    };
  }

  list(): LibraryNovel[] {
    const rows = this.db
      .prepare(`${SELECT_NOVELS} ORDER BY n.name COLLATE NOCASE, n.id`)
      .all() as unknown as NovelRow[];
    return rows.map(r => this.toNovel(r));
  }

  get(pluginId: string, path: string): LibraryNovel | undefined {
    const row = this.db
      .prepare(`${SELECT_NOVELS} WHERE n.plugin_id = ? AND n.path = ?`)
      .get(pluginId, path) as unknown as NovelRow | undefined;
    return row ? this.toNovel(row) : undefined;
  }

  /** Add (or re-follow) a novel. Keeps its known chapters if already followed. */
  follow(
    pluginId: string,
    path: string,
    novel: Pick<Plugin.SourceNovel, 'name' | 'author' | 'cover'> & {
      url?: string;
    },
    options: FollowOptions,
  ): LibraryNovel {
    this.db
      .prepare(
        `INSERT INTO novels (plugin_id, path, name, author, cover, url, options, followed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (plugin_id, path) DO UPDATE SET
           name = excluded.name, author = excluded.author, cover = excluded.cover,
           url = excluded.url, options = excluded.options`,
      )
      .run(
        pluginId,
        path,
        novel.name || path,
        novel.author ?? null,
        novel.cover ?? null,
        novel.url ?? null,
        JSON.stringify(options),
        now(),
      );
    return this.get(pluginId, path)!;
  }

  unfollow(id: number): void {
    this.db.prepare('DELETE FROM novels WHERE id = ?').run(id);
  }

  /** Paths of chapters already delivered. */
  knownPaths(id: number): Set<string> {
    const rows = this.db
      .prepare('SELECT path FROM chapters WHERE novel_id = ?')
      .all(id) as Array<{ path: string }>;
    return new Set(rows.map(r => r.path));
  }

  /** Record a check: refreshed metadata and the source's current chapter count. */
  recordCheck(id: number, novel: Plugin.SourceNovel, totalCount: number): void {
    this.db
      .prepare(
        `UPDATE novels SET checked_at = ?, total_count = ?,
           name = COALESCE(NULLIF(?, ''), name),
           author = COALESCE(?, author),
           cover = COALESCE(?, cover)
         WHERE id = ?`,
      )
      .run(
        now(),
        totalCount,
        novel.name ?? '',
        novel.author ?? null,
        novel.cover ?? null,
        id,
      );
  }

  /** Mark chapters as delivered and record the files that contain them. */
  recordDelivered(
    id: number,
    chapters: Array<{ path: string; name: string; position: number }>,
    files: string[],
    kind: LibraryOutput['kind'],
  ): void {
    const at = now();
    const insertChapter = this.db.prepare(
      `INSERT INTO chapters (novel_id, path, name, position, first_seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (novel_id, path) DO UPDATE SET name = excluded.name, position = excluded.position`,
    );
    const insertOutput = this.db.prepare(
      `INSERT INTO outputs (novel_id, file, kind, built_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (novel_id, file) DO UPDATE SET kind = excluded.kind, built_at = excluded.built_at`,
    );
    this.db.exec('BEGIN');
    try {
      for (const c of chapters) {
        insertChapter.run(id, c.path, c.name || '', c.position, at);
      }
      for (const f of files) insertOutput.run(id, f, kind, at);
      if (chapters.length) {
        this.db
          .prepare('UPDATE novels SET updated_at = ? WHERE id = ?')
          .run(at, id);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  outputs(id: number): LibraryOutput[] {
    const rows = this.db
      .prepare(
        'SELECT file, kind, built_at FROM outputs WHERE novel_id = ? ORDER BY built_at, file',
      )
      .all(id) as Array<{
      file: string;
      kind: LibraryOutput['kind'];
      built_at: string;
    }>;
    return rows.map(r => ({ file: r.file, kind: r.kind, builtAt: r.built_at }));
  }
}
