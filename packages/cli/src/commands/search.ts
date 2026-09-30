import type { PluginEntry } from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import {
  openRuntime,
  saveLastSearch,
  type GlobalOptions,
  type LastSearchItem,
} from '../context.js';
import { log, out, printJson, truncate } from '../ui/format.js';
import { Progress } from '../ui/progress.js';
import { requireText } from '../ui/prompts.js';

type SearchOptions = {
  plugin?: string[];
  lang?: string;
  page: string;
  json?: boolean;
  limit: string;
};

/** Plugins searched at once when searching everything; each hits a different host. */
const PARALLEL_PLUGINS = 8;

export function registerSearch(program: Command) {
  program
    .command('search [query...]')
    .description('Search one, several or all plugins')
    .option('-p, --plugin <id...>', 'plugin id(s) to search; all when omitted')
    .option('--lang <lang>', 'only plugins for this language')
    .option('--page <n>', 'result page', '1')
    .option('--limit <n>', 'max results shown per plugin', '10')
    .option('--json', 'output JSON')
    .action(async (words: string[], opts: SearchOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const query = await requireText(
        words.join(' ').trim() || undefined,
        'Search for',
        'query',
      );
      const rt = await openRuntime(globals);
      let entries = await rt.registry.list(globals.refresh);
      if (opts.plugin?.length) {
        entries = await Promise.all(opts.plugin.map(id => rt.registry.get(id)));
      } else if (opts.lang) {
        const lang = opts.lang.toLowerCase();
        entries = entries.filter(e => e.lang.toLowerCase().includes(lang));
      }
      if (entries.length > 20 && !opts.json) {
        log.info(
          `Searching ${entries.length} plugins; narrow with --plugin or --lang`,
        );
      }

      const page = Number(opts.page) || 1;
      const limit = Number(opts.limit) || 10;
      const results: Array<{
        entry: PluginEntry;
        items: LastSearchItem[];
        error?: string;
      }> = [];
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
                  items: items.map(i => ({ ...i, pluginId: entry.id })),
                });
              } catch (e) {
                results.push({ entry, items: [], error: (e as Error).message });
              }
              if (entries.length > 1 && !opts.json)
                progress.update(++done, entries.length, entry.name);
            }
          },
        ),
      );
      progress.clear();
      await rt.close();

      // Keep the order plugins were listed in.
      const order = new Map(entries.map((e, i) => [e.id, i]));
      results.sort((a, b) => order.get(a.entry.id)! - order.get(b.entry.id)!);

      const flat: LastSearchItem[] = [];
      for (const r of results) flat.push(...r.items.slice(0, limit));
      await saveLastSearch(rt, flat);

      if (opts.json) {
        return printJson(
          results.map(r => ({
            plugin: r.entry.id,
            results: r.items.slice(0, limit).map(({ pluginId: _p, ...i }) => i),
            error: r.error,
          })),
        );
      }

      let n = 0;
      for (const r of results) {
        if (r.items.length === 0) continue;
        out(pc.bold(`${r.entry.name} ${pc.dim(`(${r.entry.id})`)}`));
        for (const item of r.items.slice(0, limit)) {
          n++;
          out(
            `  ${pc.cyan(String(n).padStart(3))}  ${truncate(item.name || item.path, 70)}  ${pc.dim(item.path)}`,
          );
        }
        out();
      }
      const failures = results.filter(r => r.error);
      if (entries.length === 1 && failures[0])
        throw new Error(failures[0].error);
      if (failures.length)
        log.warn(
          `${failures.length} plugin(s) failed; rerun with --verbose for details`,
        );
      if (globals.verbose)
        for (const f of failures) log.error(`${f.entry.id}: ${f.error}`);
      if (n === 0) log.info('No results');
      else
        log.info(
          `Use ${pc.bold('lnreader info <n>')} or ${pc.bold('lnreader download <n>')} with a result number`,
        );
    });
}
