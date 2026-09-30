import {
  DEFAULT_REPO,
  loadConfig,
  saveConfig,
  testPlugin,
} from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, type GlobalOptions } from '../context.js';
import { log, out, printJson, table } from '../ui/format.js';

export function registerPlugins(program: Command) {
  const plugins = program
    .command('plugins')
    .description('List plugins and manage plugin repos');

  plugins
    .command('list')
    .description('List available plugins from configured repos')
    .option('--lang <lang>', 'only plugins for this language (substring match)')
    .option('--search <text>', 'filter by name, id or site')
    .option('--json', 'output JSON')
    .action(
      async (
        opts: { lang?: string; search?: string; json?: boolean },
        cmd: Command,
      ) => {
        const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
        let entries = await rt.registry.list(
          cmd.optsWithGlobals<GlobalOptions>().refresh,
        );
        if (opts.lang) {
          const lang = opts.lang.toLowerCase();
          entries = entries.filter(e => e.lang.toLowerCase().includes(lang));
        }
        if (opts.search) {
          const q = opts.search.toLowerCase();
          entries = entries.filter(e =>
            [e.id, e.name, e.site].some(v => v.toLowerCase().includes(q)),
          );
        }
        if (opts.json) return printJson(entries);
        out(
          table(
            [
              [
                pc.bold('ID'),
                pc.bold('Name'),
                pc.bold('Lang'),
                pc.bold('Version'),
                pc.bold('Site'),
              ],
              ...entries.map(e => [
                e.id,
                e.name,
                e.lang.replace(/‎/g, ''),
                e.version,
                e.site,
              ]),
            ],
            [24, 28, 16],
          ),
        );
        log.info(`${entries.length} plugins`);
      },
    );

  const repo = plugins.command('repo').description('Manage plugin repo URLs');

  plugins
    .command('test <plugin>')
    .description(
      'Check a plugin against its live site: popular, search, novel and first chapter',
    )
    .option('--json', 'output JSON')
    .action(async (id: string, opts: { json?: boolean }, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      try {
        const result = await testPlugin(rt.loader, id, { budget: rt.budget });
        if (!result.ok) process.exitCode = 1;
        if (opts.json) return printJson(result);
        for (const s of result.steps) {
          const mark = s.ok
            ? pc.green('✔')
            : s.skipped
              ? pc.dim('-')
              : pc.red('✖');
          const detail = s.error
            ? pc.red(s.error.message)
            : pc.dim(s.detail ?? '');
          out(`${mark} ${s.step.padEnd(8)} ${detail}`);
          if (s.error?.hint) out(`  ${' '.repeat(8)} ${pc.dim(s.error.hint)}`);
        }
      } finally {
        await rt.close();
      }
    });

  repo
    .command('list')
    .description('Show configured repos')
    .option('--json', 'output JSON')
    .action(async (opts: { json?: boolean }, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      if (opts.json) return printJson(rt.config.repos);
      for (const url of rt.config.repos) out(url);
    });

  repo
    .command('add <url>')
    .description('Add a repo index URL (a plugins.min.json)')
    .action(async (url: string, _opts, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      const config = await loadConfig(rt.paths);
      new URL(url);
      if (config.repos.includes(url)) {
        log.info('Repo already configured');
        return;
      }
      config.repos.push(url);
      await saveConfig(rt.paths, config);
      log.success(`Added ${url}`);
    });

  repo
    .command('remove <url>')
    .description('Remove a repo')
    .action(async (url: string, _opts, cmd: Command) => {
      const rt = await openRuntime(cmd.optsWithGlobals<GlobalOptions>());
      const config = await loadConfig(rt.paths);
      if (!config.repos.includes(url))
        throw new Error(`Repo not configured: ${url}`);
      config.repos = config.repos.filter(r => r !== url);
      if (config.repos.length === 0) {
        log.warn('No repos left; the default repo will be used');
        config.repos = [DEFAULT_REPO];
      }
      await saveConfig(rt.paths, config);
      log.success(`Removed ${url}`);
    });
}
