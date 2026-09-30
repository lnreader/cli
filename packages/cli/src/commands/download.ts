import {
  downloadNovel,
  type DownloadEvent,
  type PluginRunner,
  type Runtime,
} from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, resolveNovel, type GlobalOptions } from '../context.js';
import { browse } from '../ui/browse.js';
import { formatBytes, log, printJson } from '../ui/format.js';
import { Progress } from '../ui/progress.js';
import { askText, isInteractive, requireText } from '../ui/prompts.js';
import type { ParsedNovel } from './info.js';
import { reportFailures, searchPlugins } from './search.js';

export type DownloadFlags = {
  plugin?: string;
  lang?: string;
  from?: string;
  to?: string;
  split?: string;
  out?: string;
  format?: string;
  images?: boolean;
  offline?: boolean;
  css?: string;
  json?: boolean;
};

const positiveInt = (name: string, v?: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`--${name} must be a positive integer`);
  return n;
};

/** Terminal output for download events. */
export function progressLogger(progress: Progress) {
  return (e: DownloadEvent) => {
    switch (e.type) {
      case 'page':
        progress.update(e.page, e.total, 'reading chapter list');
        break;
      case 'novel':
        progress.clear();
        log.info(
          `${pc.bold(e.novel.name)}: ${e.selected} of ${e.total} chapters` +
            (e.fromCache ? pc.yellow(' (metadata from cache)') : ''),
        );
        break;
      case 'chapter':
        progress.update(e.done, e.total, e.chapter.name);
        break;
      case 'chapter-failed':
        progress.clear();
        log.warn(
          `Chapter ${e.index} "${e.chapter.name}" failed: ${e.error.message}`,
        );
        break;
      case 'building':
        progress.clear();
        log.info(`Building ${e.file} (${e.chapters} chapters)`);
        break;
      case 'written':
        log.success(`Wrote ${e.file} (${formatBytes(e.bytes)})`);
        break;
    }
  };
}

/**
 * Download with progress output, Ctrl-C handling and a failure summary.
 * The caller owns (and closes) the runtime.
 */
export async function runDownload(
  rt: Runtime,
  runner: PluginRunner,
  path: string,
  flags: DownloadFlags,
  prefetched?: ParsedNovel,
): Promise<void> {
  if ((flags.format ?? 'epub') !== 'epub') {
    throw new Error(`Unsupported format "${flags.format}" (only epub)`);
  }
  const from = positiveInt('from', flags.from);
  const to = positiveInt('to', flags.to);
  const split = positiveInt('split', flags.split);

  const progress = new Progress();
  const controller = new AbortController();
  const onSigint = () => {
    progress.clear();
    log.warn(
      'Interrupted; finished chapters are cached and the next run resumes from them',
    );
    controller.abort(new Error('Interrupted'));
    void rt.close().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSigint);

  try {
    const result = await downloadNovel({
      runner,
      novelPath: path,
      cache: rt.cache,
      http: rt.http,
      jar: await rt.cookies.jar(runner.id),
      from,
      to,
      split,
      noImages: flags.images === false,
      out: flags.out ?? rt.config.outDir ?? process.cwd(),
      cssFile: flags.css ?? rt.config.css,
      offline: flags.offline,
      prefetched,
      signal: controller.signal,
      onEvent: flags.json ? undefined : progressLogger(progress),
    });
    progress.clear();
    if (flags.json) printJson(result);
    if (result.failed.length) {
      log.error(
        `${result.failed.length} chapter(s) failed: ${result.failed.map(f => f.index).join(', ')}. ` +
          'Run the same command again to retry them.',
      );
      process.exitCode = 2;
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
}

export function registerDownload(program: Command) {
  program
    .command('download [novel]')
    .description('Download a novel as EPUB')
    .option('-p, --plugin <id>', 'plugin to use for a path or URL')
    .option(
      '--lang <lang>',
      'when prompting for a search: only plugins for this language',
    )
    .option('--from <n>', 'first chapter (1-based)')
    .option('--to <n>', 'last chapter (inclusive)')
    .option('--split <n>', 'chapters per volume file')
    .option('-o, --out <path>', 'output directory or .epub file')
    .option('--format <format>', 'output format', 'epub')
    .option('--no-images', 'skip inline images')
    .option('--offline', 'build only from the cache; no network')
    .option('--css <file>', 'stylesheet replacing the default')
    .option('--json', 'print a JSON summary')
    .action(
      async (input: string | undefined, flags: DownloadFlags, cmd: Command) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        if ((flags.format ?? 'epub') !== 'epub') {
          throw new Error(`Unsupported format "${flags.format}" (only epub)`);
        }
        const rt = await openRuntime(globals);
        try {
          // No novel given and someone is at the keyboard: search, pick, download.
          if (!input && isInteractive({ ...globals, json: flags.json })) {
            const query = await askText('Search for a novel', {
              validate: v => (v.trim() ? undefined : 'Required'),
            });
            if (!query) return;
            const { results, items } = await searchPlugins(rt, query.trim(), {
              plugin: flags.plugin ? [flags.plugin] : undefined,
              lang: flags.lang,
              refresh: globals.refresh,
            });
            reportFailures(results, globals.verbose);
            if (items.length === 0) return log.info('No results');
            return await browse(rt, results, globals, {
              intent: 'download',
              flags,
            });
          }

          const novelInput = await requireText(input, 'Novel', '<novel>', {
            ...globals,
            json: flags.json,
          });
          const { runner, path } = await resolveNovel(rt, novelInput, {
            ...globals,
            plugin: flags.plugin,
          });
          await runDownload(rt, runner, path, flags);
        } finally {
          await rt.close();
        }
      },
    );
}
