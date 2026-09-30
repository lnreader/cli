import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/net/client.js';
import { CookieStore } from '../src/net/cookies.js';
import { loadPlugin } from '../src/plugins/sandbox.js';
import { resolvePaths } from '../src/store/paths.js';
import { fixtureCode, novelSite, tempHome } from './helpers.js';

describe('CookieStore', () => {
  it('imports browser cookies and persists them with the User-Agent', async () => {
    const paths = resolvePaths(await tempHome());
    const store = new CookieStore(paths);
    const count = await store.importCookies('p', [
      {
        name: 'cf_clearance',
        value: 'x',
        domain: '.site.test',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
      },
      {
        name: 'sid',
        value: '1',
        domain: 'site.test',
        expires: Date.now() / 1000 + 3600,
      },
    ]);
    expect(count).toBe(2);
    await store.setUserAgent('p', 'Browser/1.0');

    const reopened = new CookieStore(paths);
    expect(
      await (await reopened.jar('p')).getCookieString('https://site.test/a'),
    ).toBe('cf_clearance=x; sid=1');
    expect(await reopened.userAgent('p')).toBe('Browser/1.0');

    await reopened.clear('p');
    const cleared = new CookieStore(paths);
    expect(
      await (await cleared.jar('p')).getCookieString('https://site.test/'),
    ).toBe('');
    expect(await cleared.userAgent('p')).toBeUndefined();
  });

  it('imports Netscape cookies.txt', async () => {
    const home = await tempHome();
    const file = join(home, 'cookies.txt');
    await writeFile(
      file,
      '# Netscape HTTP Cookie File\n#HttpOnly_.site.test\tTRUE\t/\tTRUE\t0\tcf_clearance\tabc\nsite.test\tFALSE\t/\tFALSE\t0\tlang\ten\n',
    );
    const store = new CookieStore(resolvePaths(home));
    expect(await store.importNetscape('p', file)).toBe(2);
    expect(
      await (await store.jar('p')).getCookieString('https://site.test/'),
    ).toBe('cf_clearance=abc; lang=en');
  });
});

describe('per-plugin User-Agent', () => {
  it('is sent on plugin requests unless the plugin sets its own', async () => {
    const site = novelSite();
    const http = new HttpClient({
      concurrency: 1,
      minGapMs: 0,
      userAgent: 'default-agent',
      fetch: site.fetch,
    });
    const store = new CookieStore(resolvePaths(await tempHome()));
    const plugin = loadPlugin(await fixtureCode(), 'fixture', {
      http,
      jar: await store.jar('fixture'),
      storageFile: join(await tempHome(), 's.json'),
      userAgent: 'Browser/1.0',
    });
    await plugin.parseNovel('novel/abc');
    expect(new Headers(site.calls.at(-1)!.init.headers).get('user-agent')).toBe(
      'Browser/1.0',
    );
  });
});
