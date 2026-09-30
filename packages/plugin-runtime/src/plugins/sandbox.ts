import vm from 'node:vm';
import type { Plugin } from '../types/plugin.js';
import { callContext } from './context.js';
import { InvalidPluginError, PluginError } from './errors.js';
import { createShims, makeRequire, type ShimDeps } from './shims/index.js';

export type Logger = {
  debug(message: string): void;
  warn(message: string): void;
};

export type SandboxOptions = ShimDeps & {
  logger?: Logger;
  /** Timeout for synchronous top-level code, in ms. */
  loadTimeoutMs?: number;
};

const REQUIRED_METHODS = [
  'popularNovels',
  'parseNovel',
  'parseChapter',
  'searchNovels',
] as const;

function scopedConsole(id: string, logger?: Logger) {
  const log = (...args: unknown[]) =>
    logger?.debug(
      `[${id}] ${args.map(a => (typeof a === 'string' ? a : safeInspect(a))).join(' ')}`,
    );
  return { log, info: log, debug: log, trace: log, warn: log, error: log };
}

function safeInspect(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function assertPluginShape(
  value: unknown,
  id: string,
): Plugin.PluginBase {
  if (!value || typeof value !== 'object') {
    throw new InvalidPluginError(id, 'module did not export a plugin instance');
  }
  const p = value as Record<string, unknown>;
  for (const field of ['id', 'name', 'site', 'version'] as const) {
    // Self-hosted sources (e.g. komga) read `site` from a user setting, so it
    // may be empty until configured.
    const optional =
      field === 'site' && typeof p.site === 'string' && !!p.pluginSettings;
    if (typeof p[field] !== 'string' || (!p[field] && !optional)) {
      throw new InvalidPluginError(id, `missing string field "${field}"`);
    }
  }
  for (const method of REQUIRED_METHODS) {
    if (typeof p[method] !== 'function') {
      throw new InvalidPluginError(id, `missing method "${method}"`);
    }
  }
  return value as Plugin.PluginBase;
}

/**
 * Evaluate compiled plugin JS in a fresh `vm` context. The context has no
 * `process`, `fs`, `Buffer` or `require` beyond the shimmed modules; the
 * only network path is the fetch shim (also exposed as global `fetch`,
 * which a few upstream plugins call directly).
 */
export function loadPlugin(
  code: string,
  id: string,
  options: SandboxOptions,
): Plugin.PluginBase {
  const { modules, fetch } = createShims(options);
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require: makeRequire(id, modules),
    console: scopedConsole(id, options.logger),
    fetch,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    structuredClone,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Headers,
    FormData,
    Blob,
    Request,
    Response,
    AbortController,
    AbortSignal,
    atob,
    btoa,
  });
  new vm.Script(code, { filename: `plugin:${id}.js` }).runInContext(context, {
    timeout: options.loadTimeoutMs ?? 5_000,
  });
  const exported = module.exports.default ?? module.exports;
  return assertPluginShape(exported, id);
}

/**
 * Run an async plugin method with a timeout. The abort signal is exposed to
 * the fetch shim through AsyncLocalStorage, so timed-out calls stop fetching.
 */
export async function callPlugin<T>(
  plugin: Plugin.PluginBase,
  method: string,
  timeoutMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`timed out after ${timeoutMs / 1000}s`)),
    timeoutMs,
  );
  try {
    return await callContext.run({ signal: controller.signal }, async () => {
      const aborted = new Promise<never>((_, reject) =>
        controller.signal.addEventListener(
          'abort',
          () => reject(controller.signal.reason),
          {
            once: true,
          },
        ),
      );
      return await Promise.race([fn(), aborted]);
    });
  } catch (err) {
    throw new PluginError(plugin.id, method, err);
  } finally {
    clearTimeout(timer);
  }
}
