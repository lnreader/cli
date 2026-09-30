import {
  describeFilter,
  parseFilterArgs,
  type Runtime,
} from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, saveLastSearch, type GlobalOptions } from '../context.js';
import { browse } from '../ui/browse.js';
import { log, out, printJson, table } from '../ui/format.js';
import {
  askSearchable,
  isInteractive,
  MissingArgumentError,
} from '../ui/prompts.js';
import { printResults, type PluginResults } from './search.js';

type PopularFlags = {
  plugin?: string;
  latest?: boolean;
  filter?: string[];
  filters?: boolean;
  page: string;
  lang?: string;
  json?: boolean;
};

/** Pick a plugin from a type-to-filter list. */
async function askPlugin(rt: Runtime, lang?: string, refresh?: boolean) {
  let entries = await rt.registry.list(refresh);
  if (lang)
    entries = entries.filter(e =>
      e.lang.toLowerCase().includes(lang.toLowerCase()),
    );
  return askSearchable(
    'Which source?',
    entries.map(e => ({
      value: e.id,
      label: e.name,
      hint: `${e.id} · ${e.lang.replace(/‎/g, '')}`,
    })),
  );
}

export function registerPopular(program: Command) {
  program
    .command('popular')
    .description('Browse a source’s popular or latest novels, with its filters')
    .option(
      '-p, --plugin <id>',
      'source to browse (prompted for in a terminal)',
    )
    .option('--latest', 'latest updates instead of popular')
    .option(
      '-f, --filter <key=value...>',
      'set a filter; see --filters for what a source accepts',
    )
    .option('--filters', 'list the source’s filters and exit')
    .option('--page <n>', 'result page', '1')
    .option('--lang <lang>', 'when prompting for a source: only this language')
    .option('--json', 'output JSON')
    .action(async (flags: PopularFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const interactive = isInteractive({ ...globals, json: flags.json });
      const rt = await openRuntime(globals);
      try {
        let id = flags.plugin;
        if (!id) {
          if (!interactive)
            throw new MissingArgumentError('Missing --plugin <id>');
          id = await askPlugin(rt, flags.lang, globals.refresh);
          if (!id) return;
        }
        const runner = await rt.loader.load(id);
        const filters = runner.plugin.filters;

        if (flags.filters) {
          if (!filters || !Object.keys(filters).length) {
            return log.info(`${runner.entry.name} has no filters`);
          }
          if (flags.json) return printJson(filters);
          out(
            table(
              [
                [
                  pc.bold('Key'),
                  pc.bold('Label'),
                  pc.bold('Default'),
                  pc.bold('Accepts'),
                ],
                ...Object.entries(filters).map(([k, f]) => [
                  k,
                  f.label,
                  JSON.stringify(f.value),
                  describeFilter(f),
                ]),
              ],
              [24, 28, 20],
            ),
          );
          log.info(
            `Example: lnreader popular -p ${runner.id} -f ${Object.keys(filters)[0]}=…`,
          );
          return;
        }

        const values = parseFilterArgs(filters, flags.filter ?? []);
        const page = Number(flags.page) || 1;
        const items = await runner.popularNovels(page, {
          showLatestNovels: !!flags.latest,
          filters: values,
        });
        const results: PluginResults[] = [
          {
            entry: runner.entry,
            items: items.map(i => ({ ...i, pluginId: runner.id })),
          },
        ];
        await saveLastSearch(rt, results[0]!.items);

        if (flags.json) return printJson(items);
        if (!items.length) return log.info('No results');
        if (interactive) return await browse(rt, results, globals);
        printResults(results);
        log.info(
          `Page ${page}. Use ${pc.bold('lnreader info <n>')}, ${pc.bold('download <n>')} or ${pc.bold('follow <n>')}; ` +
            `${pc.bold(`--page ${page + 1}`)} for more`,
        );
      } finally {
        await rt.close();
      }
    });
}
