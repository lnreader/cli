import type { FollowOptions, Runtime } from '@lnreader-cli/core';
import pc from 'picocolors';
import { runDownload, type DownloadFlags } from '../commands/download.js';
import { printInfo, type ParsedNovel } from '../commands/info.js';
import { followNovel } from '../commands/library.js';
import type { PluginResults } from '../commands/search.js';
import type { GlobalOptions } from '../context.js';
import { log, out, truncate } from './format.js';
import { askSearchable, askSelect, askText, spinner } from './prompts.js';

export type BrowseOptions = {
  /** `download` and `follow` skip the action menu and go straight to their options. */
  intent?: 'browse' | 'download' | 'follow';
  /** Flags from the command line, kept when downloading. */
  flags?: DownloadFlags;
  /** Settings for following, from `lnreader follow` flags or config defaults. */
  follow?: {
    options?: FollowOptions;
    download?: boolean;
    /** Flags given explicitly, which are not asked again. */
    explicit?: { split?: string };
  };
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
 * One book or volumes of N chapters. Returns the volume size, '' for one
 * book, or undefined for "go back".
 */
export async function askSplit(count: number): Promise<string | undefined> {
  if (count <= 1) return '';
  const suggested = count > 300 ? '100' : undefined;
  const choice = await askSelect(
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
  if (!choice || choice === 'back') return undefined;
  if (choice === 'one') return '';
  const size = await askText('Chapters per volume', {
    initialValue: suggested ?? '100',
    validate: intIn(1, count),
  });
  return size?.trim();
}

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
  if (!flags.split) {
    const split = await askSplit(count);
    if (split === undefined) return undefined;
    if (split) result.split = split;
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
      const following = !!rt.library().get(runner.id, item.path);
      const action =
        opts.intent === 'download' || opts.intent === 'follow'
          ? opts.intent
          : await askSelect('What next?', [
              { value: 'download', label: 'Download' },
              {
                value: 'follow',
                label: following ? 'Follow (already following)' : 'Follow',
                hint: 'download now and keep it up to date with `lnreader update`',
              },
              { value: 'back', label: 'Back to results' },
              { value: 'quit', label: 'Quit' },
            ]);
      if (action === 'quit') return;
      if (action === 'follow') {
        const explicit = opts.follow?.explicit?.split;
        const split = explicit ?? (await askSplit(novel.chapters.length));
        if (split === undefined) {
          if (opts.intent === 'follow') break;
          continue;
        }
        const options: FollowOptions = {
          ...(opts.follow?.options ?? {
            outDir: rt.config.outDir ?? process.cwd(),
          }),
          split: split ? Number(split) : undefined,
        };
        const args = ['lnreader', 'follow', `${runner.id}:${item.path}`];
        if (split) args.push('--split', split);
        log.info(pc.dim(args.map(shellQuote).join(' ')));
        await followNovel(
          rt,
          runner,
          item.path,
          novel,
          options,
          opts.follow?.download !== false,
        );
        return;
      }
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
