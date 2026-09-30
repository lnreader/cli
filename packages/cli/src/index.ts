import { errorInfo } from '@lnreader/plugin-runtime';
import { Command, CommanderError } from 'commander';
import { registerAuth } from './commands/auth.js';
import { registerConfig } from './commands/config.js';
import { registerDownload } from './commands/download.js';
import { registerInfo } from './commands/info.js';
import { registerLibrary } from './commands/library.js';
import { registerMcp } from './commands/mcp.js';
import { registerPlugins } from './commands/plugins.js';
import { registerPopular } from './commands/popular.js';
import { registerRead } from './commands/read.js';
import { registerSchema } from './commands/schema.js';
import { registerSearch } from './commands/search.js';
import { registerSkill } from './commands/skill.js';
import { log, printJson, setQuiet } from './ui/format.js';
import { VERSION } from './version.js';

const program = new Command()
  .name('lnreader')
  .description('Search LNReader plugin sources and download novels as EPUB')
  .version(VERSION)
  .option('--home <dir>', 'store config, cache and data under this directory')
  .option('--refresh', 'ignore cached plugin indexes')
  .option('-v, --verbose', 'show plugin logs and per-plugin errors')
  .option('-q, --quiet', 'no progress or info on stderr; errors still print')
  .option(
    '--user-agent <ua>',
    'User-Agent for requests (match the browser your cookies came from)',
  )
  .option('--no-interactive', 'never prompt; print plain numbered results')
  .option(
    '--no-input',
    'never prompt; missing arguments fail with exit code 2 (implied when stdin is not a TTY)',
  )
  .option(
    '--cookies <file>',
    'import a Netscape cookies.txt into the plugin’s cookie jar',
  )
  .showHelpAfterError()
  // Throw instead of exiting, so usage errors get exit code 2 and JSON.
  .exitOverride()
  .hook('preAction', (_cmd, action) => {
    if (action.optsWithGlobals().quiet) setQuiet(true);
  });

registerPlugins(program);
registerSearch(program);
registerPopular(program);
registerInfo(program);
registerRead(program);
registerDownload(program);
registerLibrary(program);
registerConfig(program);
registerAuth(program);
registerSchema(program);
registerMcp(program);
registerSkill(program);

/** `--json` anywhere on the command line asks for machine-readable errors. */
const wantsJson = () => process.argv.slice(2).includes('--json');

/** Help, version and "no subcommand" keep commander's own exit codes. */
const PASSTHROUGH = new Set([
  'commander.helpDisplayed',
  'commander.help',
  'commander.version',
]);

/** Exit once stdout has drained, so a piped JSON error is never cut off. */
async function exit(code: number): Promise<never> {
  await new Promise<void>(resolve => process.stdout.write('', () => resolve()));
  process.exit(code);
}

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CommanderError) {
    if (PASSTHROUGH.has(e.code)) await exit(e.exitCode);
    // Commander has already printed the message and help to stderr.
    if (wantsJson())
      printJson({
        error: {
          code: 'USAGE',
          message: e.message.replace(/^error: /, ''),
          hint: 'Run with --help for usage',
        },
      });
    await exit(2);
  }
  const info = errorInfo(e);
  if (wantsJson()) printJson({ error: info });
  log.error(info.message);
  if (info.hint) log.hint(info.hint);
  if (program.opts().verbose && e instanceof Error && e.stack)
    console.error(e.stack);
  const exitCode = (e as { exitCode?: unknown } | undefined)?.exitCode;
  await exit(
    typeof exitCode === 'number' ? exitCode : info.code === 'USAGE' ? 2 : 1,
  );
}
