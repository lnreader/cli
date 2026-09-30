import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type StorageItem<T = unknown> = { created: string; value: T; expires?: number };

/**
 * `@libs/storage`: the plugin's key-value store, persisted as JSON (0600).
 * Plugins call it synchronously (often from their constructor), so I/O is sync.
 */
export class PluginStorage {
  private db: Record<string, StorageItem>;

  constructor(private readonly file: string) {
    try {
      this.db = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        StorageItem
      >;
    } catch {
      this.db = {};
    }
  }

  private flush(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  set<T>(key: string, value: T, expires?: Date | number): void {
    this.db[key] = {
      created: new Date().toISOString(),
      value,
      expires: expires instanceof Date ? expires.getTime() : expires,
    };
    this.flush();
  }

  get<T = unknown>(key: string, raw?: boolean): T | StorageItem<T> | undefined {
    const item = this.db[key] as StorageItem<T> | undefined;
    if (item?.expires && Date.now() > item.expires) {
      this.delete(key);
      return undefined;
    }
    return raw ? item : item?.value;
  }

  getAllKeys(): string[] {
    return Object.keys(this.db);
  }

  delete(key: string): void {
    if (!(key in this.db)) return;
    delete this.db[key];
    this.flush();
  }

  clearAll(): void {
    this.db = {};
    this.flush();
  }
}

/** Stand-in for the WebView's localStorage/sessionStorage snapshot. */
export class WebStorage {
  private readonly db: Record<string, string> = {};

  get(): Record<string, string> {
    return this.db;
  }
}
