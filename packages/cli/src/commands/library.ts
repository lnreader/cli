import { resolve } from 'node:path';
import {
  errorInfo,
  LnreaderError,
  updateNovel,
  type ErrorInfo,
  type FollowOptions,
  type LibraryNovel,
  type PluginRunner,
  type Runtime,
  type UpdateResult,
} from '@lnreader/plugin-runtime';
import * as p from '@clack/prompts';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, resolveNovel, type GlobalOptions } from '../context.js';
import { browse } from '../ui/browse.js';
import { log, out, printJson, table } from '../ui/format.js';
import { Progress } from '../ui/progress.js';
import { askText, isInteractive, MissingArgumentError } from '../ui/prompts.js';
import { progressLogger } from './download.js';
import type { ParsedNovel } from './info.js';
import { reportFailures, searchPlugins } from './search.js';

type FollowFlags = {
  plugin?: string;
  lang?: string;
  out?: string;
  split?: string;
  images?: boolean;
  css?: string;
  download?: boolean;
  json?: boolean;
};

const relative = (iso?: string) => {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
};

export function followOptionsFrom(
  rt: Runtime,
  flags: FollowFlags,
): FollowOptions {
  const split = flags.split === undefined ? undefined : Number(flags.split);
  if (split !== undefined && (!Number.isInteger(split) || split < 1)) {
    throw new Error('--split must be a positive integer');
  }
  return {
    outDir: resolve(flags.out ?? rt.config.outDir ?? process.cwd()),
    split,
    noImages: flags.images === false ? true : undefined,
    css: flags.css ? resolve(flags.css) : undefined,
  };
}

export type FollowOutcome = {
  novel: LibraryNovel;
  alreadyFollowed: boolean;
  update?: UpdateResult;
  error?: ErrorInfo;
};

/** Add a novel to the library and, unless told not to, download it now. */
export async function followNovel(
  rt: Runtime,
  runner: PluginRunner,
  path: string,
  novel: ParsedNovel,
  options: FollowOptions,
  download = true,
  json = false,
): Promise<FollowOutcome> {
  const library = rt.library();
  const already = library.get(runner.id, path);
  const entry = library.follow(
    runner.id,
    path,
    {
      name: novel.name,
      author: novel.author,
      cover: novel.cover,
      url: runner.resolveUrl(path, true),
    },
    options,
  );
  if (!json)
    log.success(
      `${already ? 'Updated' : 'Following'} ${pc.bold(entry.name)} → ${options.outDir}`,
    );
  if (!download) {
    if (!json) log.info(`Run ${pc.bold('lnreader update')} to download it`);
    return { novel: entry, alreadyFollowed: !!already };
  }
  const outcome = await updateOne(
    rt,
    entry,
    { json },
    runner,
    undefined,
    novel,
  );
  return {
    novel: rt.library().get(runner.id, path) ?? entry,
    alreadyFollowed: !!already,
    update: outcome.result,
    error: outcome.info,
  };
}

/** Resolve `<novel>` against the library: list number, name, URL or plugin:path. */
export async function findFollowed(
  rt: Runtime,
  input: string,
  globals: GlobalOptions & { plugin?: string },
): Promise<LibraryNovel> {
  const novels = rt.library().list();
  if (/^\d+$/.test(input)) {
    const n = novels[Number(input) - 1];
    if (!n)
      throw new LnreaderError(
        'NOT_FOLLOWED',
        `No novel #${input} in the library (${novels.length} followed)`,
        'See the numbers in `lnreader list`',
      );
    return n;
  }
  if (/^https?:\/\//i.test(input) || input.includes(':') || globals.plugin) {
    const { runner, path } = await resolveNovel(rt, input, globals);
    const n = rt.library().get(runner.id, path);
    if (!n) throw new LnreaderError('NOT_FOLLOWED', `Not following ${input}`);
    return n;
  }
  const q = input.toLowerCase();
  const matches = novels.filter(n => n.name.toLowerCase().includes(q));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0)
    throw new LnreaderError(
      'NOT_FOLLOWED',
      `No followed novel matches "${input}"`,
    );
  throw new LnreaderError(
    'INVALID_INPUT',
    `"${input}" matches ${matches.length} novels: ${matches.map(m => m.name).join(', ')}. Use its number from \`lnreader list\`.`,
  );
}

type UpdateOutcome = {
  novel: LibraryNovel;
  result?: UpdateResult;
  error?: string;
  info?: ErrorInfo;
};

async function updateOne(
  rt: Runtime,
  novel: LibraryNovel,
  flags: { delta?: boolean; json?: boolean },
  preloaded?: PluginRunner,
  signal?: AbortSignal,
  prefetched?: ParsedNovel,
): Promise<UpdateOutcome> {
  const progress = new Progress();
  try {
    const runner = preloaded ?? (await rt.loader.load(novel.pluginId));
    const result = await updateNovel({
      library: rt.library(),
      novel,
      runner,
      cache: rt.cache,
      http: rt.http,
      jar: await rt.cookies.jar(runner.id),
      delta: flags.delta,
      prefetched,
      signal,
      onEvent: flags.json ? undefined : progressLogger(progress),
    });
    progress.clear();
    if (!flags.json) {
      if (result.status === 'up-to-date') {
        log.info(
          `${pc.bold(novel.name)}: up to date (${result.total} chapters)`,
        );
      } else if (result.failed.length) {
        log.warn(
          `${pc.bold(novel.name)}: ${result.added.length - result.failed.length} of ${result.added.length} new chapters delivered; ` +
            `${result.failed.length} failed and will be retried next update`,
        );
      }
    }
    return { novel, result };
  } catch (e) {
    progress.clear();
    const info = errorInfo(e);
    if (!flags.json) log.error(`${novel.name}: ${info.message}`);
    return { novel, error: info.message, info };
  }
}

/** Update several novels in turn, then print a summary and set the exit code. */
async function updateMany(
  rt: Runtime,
  novels: LibraryNovel[],
  flags: { delta?: boolean; json?: boolean },
): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => {
    log.warn(
      'Interrupted; finished chapters are cached and the next update resumes from them',
    );
    controller.abort(new Error('Interrupted'));
    void rt.close().finally(() => process.exit(130));
  };
  process.once('SIGINT', onSigint);
  const outcomes: UpdateOutcome[] = [];
  try {
    for (const novel of novels) {
      outcomes.push(
        await updateOne(rt, novel, flags, undefined, controller.signal),
      );
    }
  } finally {
    process.off('SIGINT', onSigint);
  }

  const updated = outcomes.filter(o => o.result?.status === 'updated');
  const errors = outcomes.filter(o => o.error);
  const chapterFailures = updated.reduce(
    (n, o) => n + (o.result?.status === 'updated' ? o.result.failed.length : 0),
    0,
  );
  if (flags.json) {
    printJson(
      outcomes.map(o => ({
        plugin: o.novel.pluginId,
        path: o.novel.path,
        name: o.novel.name,
        ...(o.result ?? {}),
        error: o.error,
        errorCode: o.info?.code,
      })),
    );
  } else if (novels.length > 1) {
    const added = updated.reduce(
      (n, o) =>
        n + (o.result?.status === 'updated' ? o.result.added.length : 0),
      0,
    );
    log.info(
      `${novels.length} checked: ${updated.length} updated (${added} new chapters), ` +
        `${outcomes.length - updated.length - errors.length} up to date` +
        (errors.length ? `, ${errors.length} failed` : ''),
    );
  }
  if (errors.length) process.exitCode = 1;
  else if (chapterFailures) process.exitCode = 2;
}

export function registerLibrary(program: Command) {
  program
    .command('follow [novel]')
    .description(
      'Add a novel to your library and download it; `update` fetches new chapters later',
    )
    .option('-p, --plugin <id>', 'plugin to use for a path or URL')
    .option(
      '--lang <lang>',
      'when prompting for a search: only plugins for this language',
    )
    .option('-o, --out <dir>', 'where this novel’s EPUBs go')
    .option('--split <n>', 'chapters per volume file')
    .option('--no-images', 'skip inline images')
    .option('--css <file>', 'stylesheet replacing the default')
    .option(
      '--no-download',
      'only add to the library; download on the next update',
    )
    .option('--json', 'print a JSON summary')
    .action(
      async (input: string | undefined, flags: FollowFlags, cmd: Command) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const rt = await openRuntime(globals);
        try {
          const options = followOptionsFrom(rt, flags);
          if (!input) {
            if (!isInteractive({ ...globals, json: flags.json }))
              throw new MissingArgumentError('Missing <novel>');
            const query = await askText('Search for a novel to follow', {
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
              intent: 'follow',
              follow: {
                options,
                download: flags.download !== false,
                explicit: flags,
              },
            });
          }
          const { runner, path } = await resolveNovel(rt, input, {
            ...globals,
            plugin: flags.plugin,
          });
          const novel = await runner.parseNovel(path);
          const outcome = await followNovel(
            rt,
            runner,
            path,
            novel,
            options,
            flags.download !== false,
            flags.json,
          );
          if (flags.json) printJson(outcome);
          if (outcome.error) process.exitCode = 1;
          else if (
            outcome.update?.status === 'updated' &&
            outcome.update.failed.length
          )
            process.exitCode = 2;
        } finally {
          await rt.close();
        }
      },
    );

  program
    .command('unfollow [novel]')
    .description('Remove a novel from your library (its EPUBs are kept)')
    .option('-p, --plugin <id>', 'plugin to use for a path or URL')
    .option('--json', 'print the removed entry as JSON')
    .action(
      async (
        input: string | undefined,
        flags: { plugin?: string; json?: boolean },
        cmd: Command,
      ) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const rt = await openRuntime(globals);
        try {
          let novel: LibraryNovel | undefined;
          if (input)
            novel = await findFollowed(rt, input, { ...globals, ...flags });
          else {
            if (!isInteractive({ ...globals, json: flags.json }))
              throw new MissingArgumentError('Missing <novel>');
            const novels = rt.library().list();
            if (!novels.length) return log.info('Your library is empty');
            const picked = await p.select({
              message: 'Unfollow which novel?',
              options: novels.map(n => ({
                value: String(n.id),
                label: n.name,
                hint: n.pluginId,
              })),
            });
            if (p.isCancel(picked)) return;
            novel = novels.find(n => String(n.id) === picked);
          }
          rt.library().unfollow(novel!.id);
          if (flags.json) printJson({ unfollowed: novel });
          else log.success(`Unfollowed ${pc.bold(novel!.name)}`);
        } finally {
          await rt.close();
        }
      },
    );

  program
    .command('list')
    .alias('library')
    .description('Show the novels you follow')
    .option('--json', 'output JSON')
    .action(async (flags: { json?: boolean }, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      try {
        const library = rt.library();
        const novels = library.list();
        if (flags.json) {
          return printJson(
            novels.map(n => ({ ...n, outputs: library.outputs(n.id) })),
          );
        }
        if (!novels.length) {
          return log.info(
            `Your library is empty. Add a novel with ${pc.bold('lnreader follow')}`,
          );
        }
        out(
          table(
            [
              ['#', 'Title', 'Source', 'Chapters', 'Checked', 'Output'].map(h =>
                pc.bold(h),
              ),
              ...novels.map((n, i) => {
                const pending = n.totalCount - n.knownCount;
                return [
                  String(i + 1),
                  n.name,
                  n.pluginId,
                  pending > 0
                    ? `${n.knownCount}/${n.totalCount} ${pc.yellow(`+${pending} new`)}`
                    : String(n.knownCount),
                  relative(n.checkedAt),
                  n.options.outDir,
                ];
              }),
            ],
            [4, 40, 18],
          ),
        );
      } finally {
        await rt.close();
      }
    });

  program
    .command('update [novel...]')
    .description(
      'Fetch new chapters for followed novels and rebuild their EPUBs',
    )
    .option('-a, --all', 'update every followed novel')
    .option(
      '--delta',
      'write only the new chapters to a separate "New Chapters" EPUB',
    )
    .option('--json', 'print a JSON summary')
    .action(
      async (
        inputs: string[],
        flags: { all?: boolean; delta?: boolean; json?: boolean },
        cmd: Command,
      ) => {
        const globals = cmd.optsWithGlobals<GlobalOptions>();
        const rt = await openRuntime(globals);
        try {
          const all = rt.library().list();
          let targets: LibraryNovel[];
          if (
            flags.all ||
            (inputs.length === 0 &&
              !isInteractive({ ...globals, json: flags.json }))
          ) {
            if (!flags.all)
              throw new MissingArgumentError(
                'Missing <novel>; pass --all to update everything',
              );
            targets = all;
          } else if (inputs.length) {
            targets = [];
            for (const input of inputs)
              targets.push(await findFollowed(rt, input, globals));
          } else {
            if (!all.length) {
              return log.info(
                `Your library is empty. Add a novel with ${pc.bold('lnreader follow')}`,
              );
            }
            const picked = await p.multiselect({
              message: 'Update which novels?',
              options: all.map(n => ({
                value: String(n.id),
                label: n.name,
                hint: n.pluginId,
              })),
              initialValues: all.map(n => String(n.id)),
              required: true,
            });
            if (p.isCancel(picked)) return;
            targets = all.filter(n =>
              (picked as string[]).includes(String(n.id)),
            );
          }
          if (!targets.length) {
            return log.info(
              `Your library is empty. Add a novel with ${pc.bold('lnreader follow')}`,
            );
          }
          await updateMany(rt, targets, flags);
        } finally {
          await rt.close();
        }
      },
    );
}
