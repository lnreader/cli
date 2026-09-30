import { readFile, rm } from 'node:fs/promises';
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

  /** Add cookies (e.g. captured from a browser) to a plugin's jar and save it. */
  async importCookies(
    pluginId: string,
    cookies: SimpleCookie[],
  ): Promise<number> {
    const jar = await this.jar(pluginId);
    let count = 0;
    for (const c of cookies) {
      const host = c.domain.replace(/^\./, '');
      const cookie = new Cookie({
        key: c.name,
        value: c.value,
        domain: host,
        path: c.path || '/',
        secure: !!c.secure,
        httpOnly: !!c.httpOnly,
        expires:
          c.expires && c.expires > 0 ? new Date(c.expires * 1000) : 'Infinity',
      });
      await jar.setCookie(
        cookie,
        `${c.secure ? 'https' : 'http'}://${host}${cookie.path}`,
        {
          ignoreError: true,
        },
      );
      count++;
    }
    await this.save(pluginId);
    return count;
  }

  /** Import a Netscape-format cookies.txt (as exported by browser extensions). */
  async importNetscape(pluginId: string, file: string): Promise<number> {
    const cookies: SimpleCookie[] = [];
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
      cookies.push({
        name,
        value,
        domain,
        path,
        secure: secure.toUpperCase() === 'TRUE',
        httpOnly,
        expires: Number(expires),
      });
    }
    return this.importCookies(pluginId, cookies);
  }

  private authFile(pluginId: string): string {
    return join(this.paths.data, 'plugins', pluginId, 'auth.json');
  }

  /** The User-Agent saved by `lnreader auth`, which the saved cookies belong to. */
  async userAgent(pluginId: string): Promise<string | undefined> {
    return (await readJson<{ userAgent?: string }>(this.authFile(pluginId)))
      ?.userAgent;
  }

  async setUserAgent(pluginId: string, userAgent: string): Promise<void> {
    await writeJson(
      this.authFile(pluginId),
      { userAgent, savedAt: new Date().toISOString() },
      0o600,
    );
  }

  /** Forget a plugin's cookies and saved User-Agent. */
  async clear(pluginId: string): Promise<void> {
    this.jars.set(pluginId, new CookieJar());
    await this.save(pluginId);
    await rm(this.authFile(pluginId), { force: true });
  }
}

/** A browser-style cookie; `expires` is in Unix seconds, -1 or 0 for session cookies. */
export type SimpleCookie = {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
};
