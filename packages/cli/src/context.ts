import { join } from 'node:path';
import {
  createRuntime,
  readJson,
  writeJson,
  type Plugin,
  type PluginRunner,
  type Runtime,
} from '@lnreader-cli/core';
import pc from 'picocolors';
import { err } from './ui/format.js';

export type GlobalOptions = {
  home?: string;
  refresh?: boolean;
  verbose?: boolean;
  userAgent?: string;
  cookies?: string;
};

export async function openRuntime(opts: GlobalOptions): Promise<Runtime> {
  return createRuntime({
    home: opts.home,
    overrides: { userAgent: opts.userAgent },
    logger: {
      debug: m => opts.verbose && err(pc.dim(m)),
      warn: m => err(pc.yellow(m)),
    },
  });
}

export type LastSearchItem = Plugin.NovelItem & { pluginId: string };

const lastSearchFile = (rt: Runtime) => join(rt.paths.data, 'last-search.json');

export async function saveLastSearch(rt: Runtime, items: LastSearchItem[]) {
  await writeJson(lastSearchFile(rt), items);
}

export type ResolvedNovel = { runner: PluginRunner; path: string };

/**
 * `<novel>` is a URL (plugin found by its `site`), `plugin:path`, a path with
 * `--plugin`, or a 1-based index into the last search.
 */
export async function resolveNovel(
  rt: Runtime,
  input: string,
  opts: GlobalOptions & { plugin?: string },
): Promise<ResolvedNovel> {
  const load = async (id: string) => {
    const runner = await rt.loader.load(id);
    if (opts.cookies) await rt.cookies.importNetscape(runner.id, opts.cookies);
    return runner;
  };

  if (/^\d+$/.test(input)) {
    const items = (await readJson<LastSearchItem[]>(lastSearchFile(rt))) ?? [];
    const item = items[Number(input) - 1];
    if (!item)
      throw new Error(
        `No result #${input} in the last search (${items.length} results)`,
      );
    return { runner: await load(item.pluginId), path: item.path };
  }

  if (/^https?:\/\//i.test(input)) {
    if (opts.plugin) {
      const runner = await load(opts.plugin);
      const site = runner.plugin.site.replace(/\/*$/, '/');
      return {
        runner,
        path: input.startsWith(site) ? input.slice(site.length) : input,
      };
    }
    const match = await rt.registry.resolveUrl(input);
    if (!match)
      throw new Error(
        `No plugin matches ${new URL(input).host}; pass --plugin <id>`,
      );
    return { runner: await load(match.entry.id), path: match.path };
  }

  const colon = input.indexOf(':');
  if (colon > 0 && !opts.plugin) {
    return {
      runner: await load(input.slice(0, colon)),
      path: input.slice(colon + 1),
    };
  }
  if (opts.plugin) return { runner: await load(opts.plugin), path: input };
  throw new Error(
    `Can't tell which plugin "${input}" belongs to; use a URL, plugin:path or --plugin`,
  );
}
