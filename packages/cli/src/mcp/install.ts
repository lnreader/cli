import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LnreaderError, writeFileAtomic } from '@lnreader-cli/core';

export const MCP_CLIENTS = ['claude-desktop', 'claude-code', 'cursor'] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export type ServerEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

/** Where each client keeps its MCP servers, by scope. */
export function clientConfigPath(
  client: McpClient,
  scope: 'user' | 'project',
  env: { platform?: NodeJS.Platform; home?: string; cwd?: string } = {},
): string {
  const platform = env.platform ?? process.platform;
  const home = env.home ?? homedir();
  const cwd = env.cwd ?? process.cwd();
  switch (client) {
    case 'claude-desktop': {
      if (scope === 'project')
        throw new LnreaderError(
          'INVALID_INPUT',
          'Claude Desktop has no project config; use --scope user',
        );
      if (platform === 'darwin')
        return join(
          home,
          'Library',
          'Application Support',
          'Claude',
          'claude_desktop_config.json',
        );
      if (platform === 'win32')
        return join(
          process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
          'Claude',
          'claude_desktop_config.json',
        );
      return join(home, '.config', 'Claude', 'claude_desktop_config.json');
    }
    case 'claude-code':
      return scope === 'project'
        ? join(cwd, '.mcp.json')
        : join(home, '.claude.json');
    case 'cursor':
      return scope === 'project'
        ? join(cwd, '.cursor', 'mcp.json')
        : join(home, '.cursor', 'mcp.json');
  }
}

/** This installation's `bin/lnreader.js`, for `--local`. */
function localBin(): string {
  for (const rel of ['../bin/lnreader.js', '../../bin/lnreader.js']) {
    const file = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(file)) return file;
  }
  throw new LnreaderError(
    'INTERNAL',
    'Could not find this installation’s bin/lnreader.js',
  );
}

/**
 * The server entry: `npx -y lnreader-cli mcp` by default, or this exact
 * installation with `local` (useful before the package is published).
 */
export function serverEntry(opts: {
  local?: boolean;
  home?: string;
}): ServerEntry {
  const entry: ServerEntry = opts.local
    ? { command: process.execPath, args: [localBin(), 'mcp'] }
    : { command: 'npx', args: ['-y', 'lnreader-cli', 'mcp'] };
  if (opts.home) entry.env = { LNREADER_HOME: resolve(opts.home) };
  return entry;
}

export type InstallResult = {
  client: McpClient;
  file: string;
  name: string;
  entry: ServerEntry;
  status: 'added' | 'updated' | 'unchanged';
};

/**
 * Merge `mcpServers.<name>` into a client's JSON config, keeping every other
 * key. Refuses to touch a file that isn't valid JSON.
 */
export async function installServer(opts: {
  client: McpClient;
  file: string;
  entry: ServerEntry;
  name?: string;
  dryRun?: boolean;
}): Promise<InstallResult> {
  const name = opts.name ?? 'lnreader';
  let config: Record<string, unknown> = {};
  let raw: string | undefined;
  try {
    raw = await readFile(opts.file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (raw?.trim()) {
    try {
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new LnreaderError(
        'INVALID_INPUT',
        `${opts.file} is not valid JSON; not changing it`,
        'Fix the file, or print the entry with --print and add it by hand',
      );
    }
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new LnreaderError(
        'INVALID_INPUT',
        `${opts.file} does not hold a JSON object`,
      );
  }
  const servers = (config.mcpServers ?? {}) as Record<string, unknown>;
  const before = servers[name];
  const status: InstallResult['status'] =
    before === undefined
      ? 'added'
      : JSON.stringify(before) === JSON.stringify(opts.entry)
        ? 'unchanged'
        : 'updated';
  if (status !== 'unchanged' && !opts.dryRun) {
    config.mcpServers = { ...servers, [name]: opts.entry };
    await writeFileAtomic(
      opts.file,
      JSON.stringify(config, null, 2) + '\n',
      0o600,
    );
  }
  return {
    client: opts.client,
    file: opts.file,
    name,
    entry: opts.entry,
    status,
  };
}
