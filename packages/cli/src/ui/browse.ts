import type { Runtime } from '@lnreader-cli/core';
import pc from 'picocolors';
import { runDownload, type DownloadFlags } from '../commands/download.js';
import { printInfo, type ParsedNovel } from '../commands/info.js';
import type { PluginResults } from '../commands/search.js';
import type { GlobalOptions } from '../context.js';
import { log, out, truncate } from './format.js';
import { askSearchable, askSelect, askText, spinner } from './prompts.js';

export type BrowseOptions = {
  /** `download` skips the action menu and goes straight to download options. */
  intent?: 'browse' | 'download';
  /** Flags from the command line, kept when downloading. */
  flags?: DownloadFlags;
};

/** Quote an argument for display in a copy-pasteable shell command. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** The equivalent non-interactive command, so people learn the flags. */
export function downloadCommand(ref: string, flags: DownloadFlags): string {
  const args = ['lnreader', 'download', ref];
  if (flags.from) args.push('--from', flags.from);
  if (flags.to) args.push('--to', flags.to);
  if (flags.split) args.push('--split', flags.split);
  if (flags.out) args.push('--out', flags.out);
  if (flags.images === false) args.push('--no-images');
  if (flags.css) args.push('--css', flags.css);
  return args.map(shellQuote).join(' ');
}

const intIn = (min: number, max: number) => (v: string) => {
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= min && n <= max
    ? undefined
    : `Enter a number from ${min} to ${max}`;
};

/**
 * Ask for chapter range and volume splitting. Flags already given on the
 * command line are kept and not asked again. Undefined means "go back".
 */
export async function askDownloadOptions(
  total: number,
  flags: DownloadFlags = {},
): Promise<DownloadFlags | undefined> {
  const result: DownloadFlags = { ...flags };

  if (!flags.from && !flags.to && total > 1) {
    const range = await askSelect('Which chapters?', [
      { value: 'all', label: `All ${total} chapters` },
      { value: 'range', label: 'A range…' },
      { value: 'back', label: 'Back' },
    ]);
    if (!range || range === 'back') return undefined;
    if (range === 'range') {
      const from = await askText('From chapter', {
        initialValue: '1',
        validate: intIn(1, total),
      });
      if (!from) return undefined;
      const to = await askText('To chapter', {
        initialValue: String(total),
        validate: intIn(Number(from), total),
      });
      if (!to) return undefined;
      if (Number(from) > 1) result.from = from.trim();
      if (Number(to) < total) result.to = to.trim();
    }
  }

  const count = (Number(result.to) || total) - (Number(result.from) || 1) + 1;
  if (!flags.split && count > 1) {
    const suggested = count > 300 ? '100' : undefined;
    const split = await askSelect(
      'Output',
      [
        { value: 'one', label: 'One EPUB' },
        {
          value: 'split',
          label: 'Split into volumes…',
          hint: suggested && 'recommended for long novels',
        },
        { value: 'back', label: 'Back' },
      ],
      suggested ? 'split' : 'one',
    );
    if (!split || split === 'back') return undefined;
    if (split === 'split') {
      const size = await askText('Chapters per volume', {
        initialValue: suggested ?? '100',
        validate: intIn(1, count),
      });
      if (!size) return undefined;
      result.split = size.trim();
    }
  }
  return result;
}

/**
 * Interactive result picker: choose a novel, see its details, then download
 * it, go back to the list or quit. Esc at the list quits.
 */
export async function browse(
  rt: Runtime,
  results: PluginResults[],
  globals: GlobalOptions,
  opts: BrowseOptions = {},
): Promise<void> {
  const items = results.flatMap(r =>
    r.items.map(item => ({ item, entry: r.entry })),
  );
  const choices = items.map(({ item, entry }, i) => ({
    value: String(i),
    label: truncate(item.name || item.path, 60),
    hint: entry.name,
  }));
  let last: string | undefined;

  for (;;) {
    const picked = await askSearchable(
      `${items.length} result${items.length === 1 ? '' : 's'} · pick a novel (Esc to quit)`,
      choices,
      last,
    );
    if (picked === undefined) return;
    last = picked;
    const { item } = items[Number(picked)]!;

    const spin = spinner();
    spin.start(`Loading ${truncate(item.name || item.path, 50)}`);
    let runner;
    let novel: ParsedNovel;
    try {
      runner = await rt.loader.load(item.pluginId);
      novel = await runner.parseNovel(item.path);
      spin.stop(`Loaded ${novel.name || item.path}`);
    } catch (e) {
      spin.error('Could not load this novel');
      log.error((e as Error).message);
      continue;
    }

    out();
    printInfo(runner, item.path, novel);
    out();

    if (novel.chapters.length === 0) {
      log.warn('This novel has no chapters');
      continue;
    }

    for (;;) {
      const action =
        opts.intent === 'download'
          ? 'download'
          : await askSelect('What next?', [
              { value: 'download', label: 'Download' },
              { value: 'back', label: 'Back to results' },
              { value: 'quit', label: 'Quit' },
            ]);
      if (action === 'quit') return;
      if (action !== 'download') break;

      const flags = await askDownloadOptions(novel.chapters.length, opts.flags);
      if (!flags) {
        if (opts.intent === 'download') break;
        continue;
      }
      log.info(pc.dim(downloadCommand(`${runner.id}:${item.path}`, flags)));
      await runDownload(rt, runner, item.path, flags, novel);
      return;
    }
  }
}
