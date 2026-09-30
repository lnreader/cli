import { createInterface } from 'node:readline';
import { LnreaderError } from '@lnreader/plugin-runtime';
import type { Command } from 'commander';
import pc from 'picocolors';
import { openRuntime, type GlobalOptions } from '../context.js';
import { log } from '../ui/format.js';

type AuthFlags = {
  browser: string;
  browserPath?: string;
  clear?: boolean;
  url?: string;
  timeout: string;
};

type BrowserAddon = typeof import('@lnreader/cli-browser');

/** The add-on isn't installed: a setup problem, so exit code 2. */
export class MissingAddonError extends LnreaderError {
  readonly exitCode = 2;
  constructor() {
    super(
      'NEEDS_CONFIG',
      'Browser sign-in needs the optional add-on. Install it with:\n\n' +
        '  npm i -g @lnreader/cli-browser\n\n' +
        'It drives your installed Chrome or Edge; no browser is downloaded.',
      'Alternatively pass --cookies <cookies.txt> with --user-agent.',
    );
  }
}

/** The optional add-on, or undefined when it isn't installed. */
async function loadAddon(): Promise<BrowserAddon | undefined> {
  try {
    return await import('@lnreader/cli-browser');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND')
      return undefined;
    throw e;
  }
}

/** Resolves when Enter is pressed; the returned function stops listening. */
function waitForEnter(): { pressed: Promise<void>; stop: () => void } {
  if (!process.stdin.isTTY)
    return { pressed: new Promise(() => {}), stop: () => {} };
  const rl = createInterface({ input: process.stdin });
  const pressed = new Promise<void>(resolve =>
    rl.once('line', () => resolve()),
  );
  return { pressed, stop: () => rl.close() };
}

export function registerAuth(program: Command) {
  program
    .command('auth <plugin>')
    .description(
      'Open a browser to pass a Cloudflare check or log in; saves cookies for that plugin',
    )
    .option(
      '--browser <name>',
      'installed browser to use: chrome or msedge',
      'chrome',
    )
    .option(
      '--browser-path <path>',
      'another Chromium-based browser binary, e.g. Brave or Chromium',
    )
    .option('--url <url>', 'page to open instead of the plugin’s site')
    .option('--timeout <minutes>', 'give up after this many minutes', '10')
    .option('--clear', 'forget this plugin’s saved cookies and User-Agent')
    .action(async (id: string, flags: AuthFlags, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      if (flags.browser !== 'chrome' && flags.browser !== 'msedge') {
        throw new Error('--browser must be chrome or msedge');
      }
      const rt = await openRuntime(globals);
      try {
        const runner = await rt.loader.load(id);
        if (flags.clear) {
          await rt.cookies.clear(runner.id);
          log.success(`Cleared saved cookies and User-Agent for ${runner.id}`);
          return;
        }

        const addon = await loadAddon();
        if (!addon) throw new MissingAddonError();

        const url = flags.url ?? runner.plugin.site;
        if (!url)
          throw new Error(
            `Plugin ${runner.id} has no site configured; pass --url`,
          );
        log.info(
          `Opening ${pc.bold(url)} in ${flags.browserPath ? 'your browser' : flags.browser === 'msedge' ? 'Edge' : 'Chrome'}. ` +
            'Solve the check or log in; this finishes by itself once Cloudflare lets you through. ' +
            `Otherwise press ${pc.bold('Enter')} here when the page has loaded, or close the window.`,
        );
        const enter = waitForEnter();
        let result;
        try {
          result = await addon.authenticate({
            url,
            browser: flags.browser,
            executablePath: flags.browserPath,
            done: enter.pressed,
            timeoutMs: (Number(flags.timeout) || 10) * 60_000,
          });
        } finally {
          enter.stop();
        }

        if (result.reason === 'timeout')
          log.warn('Timed out; saving what the browser had so far');
        if (!result.cookies.length) {
          throw new Error(
            'The browser had no cookies for this site; nothing saved',
          );
        }
        const count = await rt.cookies.importCookies(runner.id, result.cookies);
        if (result.userAgent)
          await rt.cookies.setUserAgent(runner.id, result.userAgent);
        log.success(
          `Saved ${count} cookie${count === 1 ? '' : 's'} and the browser’s User-Agent for ${pc.bold(runner.id)}`,
        );
        if (!result.cookies.some(c => c.name === 'cf_clearance')) {
          log.info(
            'No Cloudflare clearance cookie was set; that’s fine if the site didn’t ask for one.',
          );
        }
      } finally {
        await rt.close();
      }
    });
}
