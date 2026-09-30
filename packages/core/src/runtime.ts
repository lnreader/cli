import { HttpClient, type FetchLike } from './net/client.js';
import { CookieStore } from './net/cookies.js';
import { PluginLoader } from './plugins/loader.js';
import { PluginRegistry } from './plugins/registry.js';
import type { Logger } from './plugins/sandbox.js';
import { ChapterCache } from './store/cache.js';
import { loadConfig, type Config } from './store/config.js';
import { resolvePaths, type Paths } from './store/paths.js';

export type RuntimeOptions = {
  /** Root for config, cache and data; defaults to OS directories or `LNREADER_HOME`. */
  home?: string;
  /** Overrides applied on top of the saved config. */
  overrides?: Partial<Config>;
  fetch?: FetchLike;
  logger?: Logger;
};

export type Runtime = {
  paths: Paths;
  config: Config;
  http: HttpClient;
  cookies: CookieStore;
  registry: PluginRegistry;
  loader: PluginLoader;
  cache: ChapterCache;
  /** Persist cookie jars. */
  close(): Promise<void>;
};

/** Wire up everything a command needs from one place. */
export async function createRuntime(
  options: RuntimeOptions = {},
): Promise<Runtime> {
  const paths = resolvePaths(options.home);
  const config = {
    ...(await loadConfig(paths)),
    ...stripUndefined(options.overrides ?? {}),
  };
  const http = new HttpClient({
    concurrency: config.concurrency,
    minGapMs: config.minGapMs,
    userAgent: config.userAgent,
    fetch: options.fetch,
  });
  const cookies = new CookieStore(paths);
  const registry = new PluginRegistry({
    http,
    paths,
    repos: config.repos,
    blacklistUrl: config.blacklistUrl,
  });
  const loader = new PluginLoader({
    registry,
    http,
    cookies,
    paths,
    timeoutMs: config.pluginTimeoutMs,
    logger: options.logger,
  });
  return {
    paths,
    config,
    http,
    cookies,
    registry,
    loader,
    cache: new ChapterCache(paths),
    close: () => cookies.saveAll(),
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
