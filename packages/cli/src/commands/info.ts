import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, resolveNovel, type GlobalOptions } from '../context.js';
import { out, printJson } from '../ui/format.js';
import { requireText } from '../ui/prompts.js';

export function registerInfo(program: Command) {
  program
    .command('info [novel]')
    .description('Show a novel’s metadata and chapter count')
    .option('-p, --plugin <id>', 'plugin to use for a path or URL')
    .option('--chapters', 'list every chapter')
    .option('--json', 'output JSON')
    .action(
      async (
        input: string | undefined,
        opts: { plugin?: string; json?: boolean; chapters?: boolean },
        cmd: Command,
      ) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const novelInput = await requireText(
          input,
          'Novel URL, plugin:path or search result #',
          '<novel>',
        );
        const rt = await openRuntime(globals);
        const { runner, path } = await resolveNovel(rt, novelInput, {
          ...globals,
          ...opts,
        });
        const novel = await runner.parseNovel(path);
        await rt.close();

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
        row(
          'Plugin',
          `${runner.entry.name} (${runner.id}@${runner.entry.version})`,
        );
        if (novel.summary) out('\n' + novel.summary.trim());
        if (opts.chapters) {
          out();
          novel.chapters.forEach((c, i) =>
            out(`${pc.cyan(String(i + 1).padStart(5))}  ${c.name}`),
          );
        }
      },
    );
}
