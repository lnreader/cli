import { Command, CommanderError } from 'commander';
import { registerConfig } from './commands/config.js';
import { registerDownload } from './commands/download.js';
import { registerInfo } from './commands/info.js';
import { registerLibrary } from './commands/library.js';
import { registerPlugins } from './commands/plugins.js';
import { registerPopular } from './commands/popular.js';
import { registerSearch } from './commands/search.js';
import { log } from './ui/format.js';
import { MissingArgumentError } from './ui/prompts.js';

declare const __VERSION__: string;

const program = new Command()
  .name('lnreader')
  .description('Search LNReader plugin sources and download novels as EPUB')
  .version(typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0-dev')
  .option('--home <dir>', 'store config, cache and data under this directory')
  .option('--refresh', 'ignore cached plugin indexes')
  .option('-v, --verbose', 'show plugin logs and per-plugin errors')
  .option(
    '--user-agent <ua>',
    'User-Agent for requests (match the browser your cookies came from)',
  )
  .option('--no-interactive', 'never prompt; print plain numbered results')
  .option(
    '--cookies <file>',
    'import a Netscape cookies.txt into the plugin’s cookie jar',
  )
  .showHelpAfterError();

registerPlugins(program);
registerSearch(program);
registerPopular(program);
registerInfo(program);
registerDownload(program);
registerLibrary(program);
registerConfig(program);

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CommanderError) process.exit(e.exitCode);
  const error = e as Error;
  log.error(error.message);
  if (e instanceof MissingArgumentError) log.info('Run with --help for usage');
  if (program.opts().verbose && error.stack) console.error(error.stack);
  process.exit(1);
}
