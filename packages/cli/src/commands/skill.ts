import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LnreaderError, writeFileAtomic } from '@lnreader-cli/core';
import type { Command } from 'commander';
import { log, out, printJson } from '../ui/format.js';

/**
 * The bundled `skills/lnreader/SKILL.md`: next to the built CLI in `dist/`,
 * or at the repo root when running from source.
 */
export function skillFile(): string {
  for (const rel of [
    './skills/lnreader/SKILL.md',
    '../../../../skills/lnreader/SKILL.md',
    '../../../skills/lnreader/SKILL.md',
  ]) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(file)) return file;
  }
  throw new LnreaderError('INTERNAL', 'The bundled SKILL.md is missing');
}

/** Skill folders Claude Code reads: per user, or per project. */
export function skillDir(
  scope: 'user' | 'project',
  env: { home?: string; cwd?: string } = {},
): string {
  return scope === 'project'
    ? join(env.cwd ?? process.cwd(), '.claude', 'skills', 'lnreader')
    : join(env.home ?? homedir(), '.claude', 'skills', 'lnreader');
}

type InstallFlags = { scope: string; dir?: string; json?: boolean };

export function registerSkill(program: Command) {
  const skill = program
    .command('skill')
    .description('The agent skill that teaches AI agents to use lnreader well');

  skill
    .command('install')
    .description(
      'Copy SKILL.md into Claude Code’s skills folder (or any folder with --dir)',
    )
    .option(
      '--scope <scope>',
      'user (~/.claude/skills) or project (./.claude/skills)',
      'user',
    )
    .option(
      '--dir <dir>',
      'install into <dir>/lnreader for another skill-aware agent',
    )
    .option('--json', 'output JSON')
    .action(async (flags: InstallFlags) => {
      if (flags.scope !== 'user' && flags.scope !== 'project')
        throw new LnreaderError(
          'INVALID_INPUT',
          '--scope must be user or project',
        );
      const dir = flags.dir
        ? join(resolve(flags.dir), 'lnreader')
        : skillDir(flags.scope);
      const file = join(dir, 'SKILL.md');
      const content = await readFile(skillFile(), 'utf8');
      let before: string | undefined;
      try {
        before = await readFile(file, 'utf8');
      } catch {
        // Not installed yet.
      }
      const status =
        before === undefined
          ? 'installed'
          : before === content
            ? 'unchanged'
            : 'updated';
      if (status !== 'unchanged') await writeFileAtomic(file, content);
      if (flags.json) return printJson({ file, status });
      log.success(
        status === 'unchanged'
          ? `The skill is already up to date at ${file}`
          : `${status === 'installed' ? 'Installed' : 'Updated'} the lnreader skill at ${file}`,
      );
    });

  skill
    .command('show')
    .description(
      'Print SKILL.md, e.g. to upload it to the Claude app as a skill',
    )
    .action(async () => {
      out((await readFile(skillFile(), 'utf8')).trimEnd());
    });

  skill
    .command('path')
    .description('Print where the bundled SKILL.md is')
    .action(() => out(skillFile()));
}
