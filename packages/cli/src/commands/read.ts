import {
  errorInfo,
  hostOf,
  locateChapter,
  LnreaderError,
  READ_FORMATS,
  readChapter,
  type ReadFormat,
} from '@lnreader/plugin-runtime';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, resolveNovel, type GlobalOptions } from '../context.js';
import { log, out, printJson } from '../ui/format.js';
import { MissingArgumentError, requireText } from '../ui/prompts.js';

type ReadFlags = {
  plugin?: string;
  format: string;
  offset?: string;
  maxChars?: string;
  from?: string;
  to?: string;
  offline?: boolean;
  json?: boolean;
};

/** Reuse a chapter list this fresh instead of re-fetching the novel page. */
const LIST_MAX_AGE_MS = 60 * 60 * 1000;

const nonNegativeInt = (name: string, v?: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0)
    throw new LnreaderError(
      'INVALID_INPUT',
      `--${name} must be a non-negative integer`,
    );
  return n;
};

export function registerRead(program: Command) {
  program
    .command('read [novel] [chapter]')
    .description(
      'Print a chapter (or a range) as Markdown, plain text, numbered paragraphs or HTML',
    )
    .option('-p, --plugin <id>', 'plugin to use for a path or URL')
    .option(
      '--format <format>',
      `output format: ${READ_FORMATS.join(', ')}`,
      'md',
    )
    .option('--offset <n>', 'start at this character (from nextOffset)')
    .option('--max-chars <n>', 'print at most this many characters')
    .option('--from <chapter>', 'first chapter of a range')
    .option('--to <chapter>', 'last chapter of a range (inclusive)')
    .option('--offline', 'read only from the cache; no network')
    .option('--json', 'output JSON')
    .addHelpText(
      'after',
      `
<chapter>, --from and --to accept a 1-based index (42), a chapter number
(ch:42) or a chapter path or URL, as listed by \`lnreader info --chapters\`.

Examples:
  lnreader read royalroad:fiction/21220 1
  lnreader read <novel> ch:180 --format text --max-chars 20000
  lnreader read <novel> --from 180 --to 220 > recap-source.md`,
    )
    .action(
      async (
        input: string | undefined,
        chapterRef: string | undefined,
        flags: ReadFlags,
        cmd: Command,
      ) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const format = flags.format as ReadFormat;
        if (!READ_FORMATS.includes(format))
          throw new LnreaderError(
            'INVALID_INPUT',
            `Unknown format "${flags.format}"`,
            `Use one of: ${READ_FORMATS.join(', ')}`,
          );
        const offset = nonNegativeInt('offset', flags.offset);
        const maxChars = nonNegativeInt('max-chars', flags.maxChars);
        if (maxChars === 0)
          throw new LnreaderError(
            'INVALID_INPUT',
            '--max-chars must be a positive integer',
          );
        const isRange = flags.from !== undefined || flags.to !== undefined;
        if (isRange && chapterRef)
          throw new MissingArgumentError(
            'Pass either <chapter> or --from/--to, not both',
          );
        if (isRange && (offset !== undefined || maxChars !== undefined))
          throw new LnreaderError(
            'INVALID_INPUT',
            '--offset and --max-chars work on a single chapter, not a range',
          );
        const novelInput = await requireText(input, 'Novel', '<novel>', {
          ...globals,
          json: flags.json,
        });
        if (!isRange && !chapterRef)
          throw new MissingArgumentError('Missing <chapter> (or --from/--to)');

        const rt = await openRuntime(globals);
        try {
          const { runner, path } = await resolveNovel(rt, novelInput, {
            ...globals,
            plugin: flags.plugin,
          });
          const base = {
            runner,
            novelPath: path,
            cache: rt.cache,
            maxAgeMs: LIST_MAX_AGE_MS,
            offline: flags.offline,
          };
          const { loaded, found } = await locateChapter({
            ...base,
            ref: chapterRef ?? flags.from ?? 1,
          });
          const novel = {
            plugin: runner.id,
            path,
            name: loaded.novel.name || path,
            url: runner.resolveUrl(path, true),
          };
          const read = (f: typeof found, whole: boolean) =>
            readChapter({
              runner,
              novelPath: path,
              cache: rt.cache,
              found: f,
              format,
              offset: whole ? undefined : offset,
              maxChars: whole ? undefined : maxChars,
              budget: rt.budget,
              offline: flags.offline,
            });

          if (!isRange) {
            const r = await read(found, false);
            if (flags.json) {
              return printJson({
                novel,
                chapter: {
                  index: r.index,
                  name: r.chapter.name,
                  path: r.chapter.path,
                },
                totalChapters: loaded.chapters.length,
                format,
                offset: r.offset,
                nextOffset: r.nextOffset,
                totalChars: r.totalChars,
                cached: r.cached,
                content: r.content,
              });
            }
            out(r.content);
            if (r.nextOffset !== undefined)
              log.info(
                `Printed ${r.content.length} of ${r.totalChars} characters; continue with ${pc.bold(`--offset ${r.nextOffset}`)}`,
              );
            return;
          }

          const last = flags.to
            ? (await locateChapter({ ...base, ref: flags.to })).found.index
            : loaded.chapters.length;
          if (last < found.index)
            throw new LnreaderError(
              'INVALID_INPUT',
              `Empty range: chapter ${found.index} to ${last}`,
            );
          // Refuse up front rather than stopping partway through the range.
          if (!flags.offline) {
            let uncached = 0;
            for (let i = found.index; i <= last; i++) {
              const c = loaded.chapters[i - 1]!;
              if (
                (await rt.cache.getChapter(runner.id, path, c.path)) ===
                undefined
              )
                uncached++;
            }
            await rt.budget.ensure(
              hostOf(runner.plugin.site) ?? runner.id,
              uncached,
            );
          }
          const results: unknown[] = [];
          let failures = 0;
          for (let index = found.index; index <= last; index++) {
            const chapter = loaded.chapters[index - 1]!;
            const ref = { index, name: chapter.name, path: chapter.path };
            try {
              const r = await read({ chapter, index }, true);
              if (flags.json)
                results.push({ ...ref, cached: r.cached, content: r.content });
              else out((index > found.index ? '\n\n' : '') + r.content);
            } catch (err) {
              const info = errorInfo(err);
              // Every later chapter would fail the same way.
              if (info.code === 'NEEDS_AUTH' || info.code === 'BUDGET_EXCEEDED')
                throw err;
              failures++;
              if (flags.json) results.push({ ...ref, error: info });
              else log.error(`Chapter ${index} failed: ${info.message}`);
            }
          }
          if (flags.json)
            printJson({
              novel,
              totalChapters: loaded.chapters.length,
              format,
              chapters: results,
            });
          if (failures) process.exitCode = 2;
        } finally {
          await rt.close();
        }
      },
    );
}
