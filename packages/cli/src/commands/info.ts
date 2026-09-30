import type { Plugin, PluginRunner } from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, resolveNovel, type GlobalOptions } from '../context.js';
import { browse } from '../ui/browse.js';
import { log, out, printJson } from '../ui/format.js';
import { askText, isInteractive, requireText } from '../ui/prompts.js';
import { reportFailures, searchPlugins } from './search.js';

export type ParsedNovel = Plugin.SourceNovel & {
  chapters: Plugin.ChapterItem[];
};

export function printInfo(
  runner: PluginRunner,
  path: string,
  novel: ParsedNovel,
  opts: { chapters?: boolean } = {},
) {
  const row = (label: string, value?: string | number) =>
    value !== undefined &&
    value !== '' &&
    out(`${pc.dim(label.padEnd(9))} ${value}`);
  out(pc.bold(novel.name || path));
  row('Author', novel.author);
  row('Artist', novel.artist);
  row('Status', novel.status);
  row('Genres', novel.genres);
  row('Rating', novel.rating);
  row('Chapters', novel.chapters.length);
  if (novel.chapters.length) {
    row('First', novel.chapters[0]!.name);
    row('Latest', novel.chapters[novel.chapters.length - 1]!.name);
  }
  row('Source', runner.resolveUrl(path, true));
  row('Plugin', `${runner.entry.name} (${runner.id}@${runner.entry.version})`);
  if (novel.summary) out('\n' + novel.summary.trim());
  if (opts.chapters) {
    out();
    novel.chapters.forEach((c, i) =>
      out(`${pc.cyan(String(i + 1).padStart(5))}  ${c.name}`),
    );
  }
}

type InfoOptions = {
  plugin?: string;
  lang?: string;
  json?: boolean;
  chapters?: boolean;
};

export function registerInfo(program: Command) {
  program
    .command('info [novel]')
    .description('Show a novel’s metadata and chapter count')
    .option('-p, --plugin <id>', 'plugin to use for a path or URL')
    .option(
      '--lang <lang>',
      'when prompting for a search: only plugins for this language',
    )
    .option('--chapters', 'list every chapter')
    .option('--json', 'output JSON')
    .action(
      async (input: string | undefined, opts: InfoOptions, cmd: Command) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const rt = await openRuntime(globals);
        try {
          // No novel given and someone is at the keyboard: search and pick.
          if (!input && isInteractive({ ...globals, json: opts.json })) {
            const query = await askText('Search for a novel', {
              validate: v => (v.trim() ? undefined : 'Required'),
            });
            if (!query) return;
            const { results, items } = await searchPlugins(rt, query.trim(), {
              plugin: opts.plugin ? [opts.plugin] : undefined,
              lang: opts.lang,
              refresh: globals.refresh,
            });
            reportFailures(results, globals.verbose);
            if (items.length === 0) return log.info('No results');
            return await browse(rt, results, globals);
          }

          const novelInput = await requireText(input, 'Novel', '<novel>', {
            ...globals,
            json: opts.json,
          });
          const { runner, path } = await resolveNovel(rt, novelInput, {
            ...globals,
            ...opts,
          });
          const novel = await runner.parseNovel(path);

          if (opts.json) {
            return printJson({
              plugin: {
                id: runner.id,
                name: runner.entry.name,
                version: runner.entry.version,
              },
              url: runner.resolveUrl(path, true),
              ...novel,
              path,
              chapterCount: novel.chapters.length,
              chapters: opts.chapters ? novel.chapters : undefined,
            });
          }
          printInfo(runner, path, novel, opts);
        } finally {
          await rt.close();
        }
      },
    );
}
