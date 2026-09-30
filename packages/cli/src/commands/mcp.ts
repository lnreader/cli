import { LnreaderError } from '@lnreader-cli/core';
import type { Command } from 'commander';
import pc from 'picocolors';
import type { GlobalOptions } from '../context.js';
import {
  clientConfigPath,
  installServer,
  MCP_CLIENTS,
  serverEntry,
  type McpClient,
} from '../mcp/install.js';
import { log, printJson } from '../ui/format.js';
import { MissingArgumentError } from '../ui/prompts.js';

type InstallFlags = {
  client?: string;
  scope: string;
  local?: boolean;
  config?: string;
  print?: boolean;
  dryRun?: boolean;
  json?: boolean;
};

export function registerMcp(program: Command) {
  const mcp = program
    .command('mcp')
    .description(
      'Run the MCP server over stdio for AI agents (started by an MCP client)',
    )
    .addHelpText(
      'after',
      `
Add it to a client:
  lnreader mcp install --client claude-desktop
  lnreader mcp install --client claude-code
  lnreader mcp install --client cursor

Or add this to the client's config by hand:
  { "mcpServers": { "lnreader": { "command": "npx", "args": ["-y", "lnreader-cli", "mcp"] } } }`,
    )
    .action(async (_flags, cmd: Command) => {
      // The SDK is only loaded here, so other commands never pay for it.
      const { runStdioServer } = await import('../mcp/server.js');
      await runStdioServer(cmd.optsWithGlobals<GlobalOptions>());
    });

  mcp
    .command('install')
    .description('Add the lnreader MCP server to an MCP client’s config')
    .option('--client <name>', `one of: ${MCP_CLIENTS.join(', ')}`)
    .option(
      '--scope <scope>',
      'user (all projects) or project (this folder; claude-code and cursor)',
      'user',
    )
    .option(
      '--local',
      'run this installation directly instead of `npx -y lnreader-cli`',
    )
    .option('--config <file>', 'write to this config file instead')
    .option('--print', 'print the server entry instead of writing it')
    .option('--dry-run', 'show what would change without writing')
    .option('--json', 'output JSON')
    .action(async (flags: InstallFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const entry = serverEntry({ local: flags.local, home: globals.home });
      if (flags.print) return printJson({ mcpServers: { lnreader: entry } });
      if (!flags.client)
        throw new MissingArgumentError(
          `Missing --client (${MCP_CLIENTS.join(', ')})`,
        );
      if (!MCP_CLIENTS.includes(flags.client as McpClient))
        throw new LnreaderError(
          'INVALID_INPUT',
          `Unknown client "${flags.client}"`,
          `Use one of: ${MCP_CLIENTS.join(', ')}; or --print and add it by hand`,
        );
      if (flags.scope !== 'user' && flags.scope !== 'project')
        throw new LnreaderError(
          'INVALID_INPUT',
          '--scope must be user or project',
        );
      const client = flags.client as McpClient;
      const file = flags.config ?? clientConfigPath(client, flags.scope);
      const result = await installServer({
        client,
        file,
        entry,
        dryRun: flags.dryRun,
      });
      if (flags.json) return printJson({ ...result, dryRun: !!flags.dryRun });
      const verb = flags.dryRun
        ? { added: 'Would add', updated: 'Would update', unchanged: 'Already' }
        : { added: 'Added', updated: 'Updated', unchanged: 'Already' };
      log.success(
        result.status === 'unchanged'
          ? `lnreader is already set up in ${file}`
          : `${verb[result.status]} lnreader in ${file}`,
      );
      if (!flags.dryRun && result.status !== 'unchanged')
        log.info(
          `Restart ${pc.bold(client)} to load it${client === 'claude-code' ? ', then check with /mcp' : ''}`,
        );
    });
}
