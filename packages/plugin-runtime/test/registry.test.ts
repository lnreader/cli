import { describe, expect, it } from 'vitest';
import { HttpClient } from '../src/net/client.js';
import { PluginRegistry, isBlacklisted } from '../src/plugins/registry.js';
import { BLACKLIST_URL } from '../src/store/config.js';
import { resolvePaths } from '../src/store/paths.js';
import { mockFetch, tempHome } from './helpers.js';

const REPO = 'https://repo.test/plugins.min.json';
const entry = (id: string, site: string, version = '1.0.0') => ({
  id,
  name: id,
  site,
  lang: 'English',
  version,
  url: `https://repo.test/${id}.js`,
});

async function setup(index: unknown[], blacklist: unknown[] = []) {
  const url = new URL(BLACKLIST_URL);
  const site = mockFetch({
    'repo.test/plugins.min.json': () => Response.json(index),
    [url.host + url.pathname]: () => Response.json(blacklist),
    'repo.test/a.js': () => new Response('// code a'),
  });
  let now = 1_000_000;
  const registry = new PluginRegistry({
    http: new HttpClient({
      concurrency: 4,
      minGapMs: 0,
      userAgent: 'ua',
      fetch: site.fetch,
    }),
    paths: resolvePaths(await tempHome()),
    repos: [REPO],
    now: () => now,
  });
  return { registry, site, advance: (ms: number) => (now += ms) };
}

describe('PluginRegistry', () => {
  it('lists entries, drops invalid and blacklisted ones', async () => {
    const { registry } = await setup(
      [
        entry('a', 'https://a.test/'),
        { id: 'broken' },
        entry('b', 'https://www.banned.test/'),
      ],
      [
        {
          name: 'Banned',
          site: 'https://banned.test/',
          aliases: ['banned.test'],
        },
      ],
    );
    expect((await registry.list()).map(e => e.id)).toEqual(['a']);
    await expect(
      registry.resolveUrl('https://banned.test/novel/1'),
    ).rejects.toThrow(/blacklisted/);
  });

  it('caches the index for 6 hours', async () => {
    const { registry, site, advance } = await setup([
      entry('a', 'https://a.test/'),
    ]);
    await registry.list();
    await registry.list(false);
    const indexCalls = () => site.calls.filter(c => c.url === REPO).length;
    expect(indexCalls()).toBe(1);
    advance(7 * 60 * 60 * 1000);
    await registry.list(true);
    expect(indexCalls()).toBe(2);
  });

  it('resolves URLs to plugins by site host, ignoring www', async () => {
    const { registry } = await setup([
      entry('a', 'https://a.test/'),
      entry('sub', 'https://multi.test/en/'),
      entry('root', 'https://multi.test/'),
    ]);
    expect(
      await registry.resolveUrl('https://www.a.test/novel/x?id=1'),
    ).toMatchObject({
      entry: { id: 'a' },
      path: 'novel/x?id=1',
    });
    expect(
      await registry.resolveUrl('https://multi.test/en/book/1'),
    ).toMatchObject({
      entry: { id: 'sub' },
      path: 'book/1',
    });
    expect(
      await registry.resolveUrl('https://multi.test/fr/book/1'),
    ).toMatchObject({
      entry: { id: 'root' },
      path: 'fr/book/1',
    });
    expect(await registry.resolveUrl('https://unknown.test/')).toBeUndefined();
  });

  it('caches plugin code by id@version', async () => {
    const { registry, site } = await setup([entry('a', 'https://a.test/')]);
    const a = await registry.get('a');
    expect(await registry.getCode(a)).toBe('// code a');
    expect(await registry.getCode(a)).toBe('// code a');
    expect(site.calls.filter(c => c.url.endsWith('a.js'))).toHaveLength(1);
  });

  it('matches blacklist entries by alias host', () => {
    expect(
      isBlacklisted({ site: 'https://www.x.test', name: 'X' }, [
        { name: 'Y', site: 'https://y.test', aliases: ['x.test'] },
      ]),
    ).toBe(true);
  });
});
