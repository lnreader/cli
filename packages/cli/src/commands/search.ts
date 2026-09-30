import type { PluginEntry, Runtime } from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  openRuntime,
  saveLastSearch,
  type GlobalOptions,
  type LastSearchItem,
} from '../context.js';
import { browse } from '../ui/browse.js';
import { log, out, printJson, truncate } from '../ui/format.js';
import { Progress } from '../ui/progress.js';
import { isInteractive, requireText } from '../ui/prompts.js';

export type SearchOptions = {
  plugin?: string[];
  lang?: string;
  page?: string;
  limit?: string;
  json?: boolean;
};

export type PluginResults = {
  entry: PluginEntry;
  items: LastSearchItem[];
  error?: string;
};

/** Plugins searched at once when searching everything; each hits a different host. */
const PARALLEL_PLUGINS = 8;

/**
 * Search the selected plugins, keeping plugin order, and save the flattened
 * results so `info <n>` / `download <n>` can refer to them.
 */
export async function searchPlugins(
  rt: Runtime,
  query: string,
  opts: SearchOptions & {
    refresh?: boolean;
    quiet?: boolean;
    /** Remember results for `info <n>`; off for agents. Default true. */
    save?: boolean;
  },
): Promise<{ results: PluginResults[]; items: LastSearchItem[] }> {
  let entries = await rt.registry.list(opts.refresh);
  if (opts.plugin?.length) {
    entries = await Promise.all(opts.plugin.map(id => rt.registry.get(id)));
  } else if (opts.lang) {
    const lang = opts.lang.toLowerCase();
    entries = entries.filter(e => e.lang.toLowerCase().includes(lang));
  }
  if (entries.length > 20 && !opts.quiet) {
    log.info(
      `Searching ${entries.length} plugins; narrow with --plugin or --lang`,
    );
  }

  const page = Number(opts.page) || 1;
  const limit = Number(opts.limit) || 10;
  const results: PluginResults[] = [];
  const progress = new Progress();
  const queue = [...entries];
  let done = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(PARALLEL_PLUGINS, queue.length) },
      async () => {
        for (let entry = queue.shift(); entry; entry = queue.shift()) {
          try {
            const runner = await rt.loader.load(entry.id);
            const items = await runner.searchNovels(query, page);
            results.push({
              entry,
              items: items
                .slice(0, limit)
                .map(i => ({ ...i, pluginId: entry.id })),
            });
          } catch (e) {
            results.push({ entry, items: [], error: (e as Error).message });
          }
          if (entries.length > 1 && !opts.quiet)
            progress.update(++done, entries.length, entry.name);
        }
      },
    ),
  );
  progress.clear();

  const order = new Map(entries.map((e, i) => [e.id, i]));
  results.sort((a, b) => order.get(a.entry.id)! - order.get(b.entry.id)!);
  const items = results.flatMap(r => r.items);
  if (opts.save !== false) await saveLastSearch(rt, items);
  return { results, items };
}

/** Warn about failed plugins; throws when the only searched plugin failed. */
export function reportFailures(results: PluginResults[], verbose?: boolean) {
  const failures = results.filter(r => r.error);
  if (results.length === 1 && failures[0]) throw new Error(failures[0].error);
  if (failures.length) {
    log.warn(
      `${failures.length} plugin(s) failed${verbose ? '' : '; rerun with --verbose for details'}`,
    );
  }
  if (verbose) for (const f of failures) log.error(`${f.entry.id}: ${f.error}`);
}

export function printResults(results: PluginResults[]) {
  let n = 0;
  for (const r of results) {
    if (r.items.length === 0) continue;
    out(pc.bold(`${r.entry.name} ${pc.dim(`(${r.entry.id})`)}`));
    for (const item of r.items) {
      n++;
      out(
        `  ${pc.cyan(String(n).padStart(3))}  ${truncate(item.name || item.path, 70)}  ${pc.dim(item.path)}`,
      );
    }
    out();
  }
  return n;
}

export function registerSearch(program: Command) {
  program
    .command('search [query...]')
    .description('Search one, several or all plugins')
    .option('-p, --plugin <id...>', 'plugin id(s) to search; all when omitted')
    .option('--lang <lang>', 'only plugins for this language')
    .option('--page <n>', 'result page', '1')
    .option('--limit <n>', 'max results per plugin', '10')
    .option('--json', 'output JSON')
    .action(async (words: string[], opts: SearchOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const interactive = isInteractive({ ...globals, json: opts.json });
      const query = await requireText(
        words.join(' ').trim() || undefined,
        'Search for',
        'query',
        {
          ...globals,
          json: opts.json,
        },
      );
      const rt = await openRuntime(globals);
      try {
        const { results, items } = await searchPlugins(rt, query, {
          ...opts,
          refresh: globals.refresh,
          quiet: opts.json,
        });

        if (opts.json) {
          return printJson(
            results.map(r => ({
              plugin: r.entry.id,
              results: r.items.map(({ pluginId: _p, ...i }) => i),
              error: r.error,
            })),
          );
        }

        reportFailures(results, globals.verbose);
        if (items.length === 0) return log.info('No results');
        if (interactive) return await browse(rt, results, globals);

        printResults(results);
        log.info(
          `Use ${pc.bold('lnreader info <n>')} or ${pc.bold('lnreader download <n>')} with a result number`,
        );
      } finally {
        await rt.close();
      }
    });
}
