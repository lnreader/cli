import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Cookie, CookieJar } from 'tough-cookie';
import { readJson, writeJson } from '../store/fs.js';
import type { Paths } from '../store/paths.js';

/** One persisted cookie jar per plugin, stored with 0600 permissions. */
export class CookieStore {
  private readonly jars = new Map<string, CookieJar>();

  constructor(private readonly paths: Paths) {}

  private file(pluginId: string): string {
    return join(this.paths.data, 'plugins', pluginId, 'cookies.json');
  }

  async jar(pluginId: string): Promise<CookieJar> {
    let jar = this.jars.get(pluginId);
    if (!jar) {
      const saved = await readJson<object>(this.file(pluginId));
      jar = saved ? await CookieJar.deserialize(saved) : new CookieJar();
      this.jars.set(pluginId, jar);
    }
    return jar;
  }

  async save(pluginId: string): Promise<void> {
    const jar = this.jars.get(pluginId);
    if (jar) await writeJson(this.file(pluginId), await jar.serialize(), 0o600);
  }

  async saveAll(): Promise<void> {
    await Promise.all([...this.jars.keys()].map(id => this.save(id)));
  }

  /** Import a Netscape-format cookies.txt (as exported by browser extensions). */
  async importNetscape(pluginId: string, file: string): Promise<number> {
    const jar = await this.jar(pluginId);
    let count = 0;
    for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
      const httpOnly = line.startsWith('#HttpOnly_');
      if (!line.trim() || (line.startsWith('#') && !httpOnly)) continue;
      const parts = (httpOnly ? line.slice('#HttpOnly_'.length) : line).split(
        '\t',
      );
      if (parts.length < 7) continue;
      const [domain, , path, secure, expires, name, value] = parts as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      const cookie = new Cookie({
        key: name,
        value,
        domain: domain.replace(/^\./, ''),
        path,
        secure: secure.toUpperCase() === 'TRUE',
        httpOnly,
        expires:
          Number(expires) > 0 ? new Date(Number(expires) * 1000) : 'Infinity',
      });
      const host = domain.replace(/^\./, '');
      await jar.setCookie(
        cookie,
        `${cookie.secure ? 'https' : 'http'}://${host}${path}`,
        {
          ignoreError: true,
        },
      );
      count++;
    }
    await this.save(pluginId);
    return count;
  }
}
