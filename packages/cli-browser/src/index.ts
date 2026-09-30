import {
  chromium,
  type Browser,
  type BrowserContext,
  type Cookie,
} from 'playwright-core';

export type BrowserChannel = 'chrome' | 'msedge';

export type AuthOptions = {
  /** Page to open, usually the plugin's site. */
  url: string;
  /** Installed browser to drive. Ignored when `executablePath` is set. */
  browser?: BrowserChannel;
  /** A specific Chromium-based browser binary. */
  executablePath?: string;
  /** For tests; a person can't solve a challenge in a headless browser. */
  headless?: boolean;
  /** Give up after this long, in ms. Default 10 minutes. */
  timeoutMs?: number;
  /** Resolves when the person says they are done (e.g. pressed Enter). */
  done?: Promise<unknown>;
  onStatus?: (message: string) => void;
};

export type AuthResult = {
  cookies: Cookie[];
  userAgent: string;
  /** Why the session ended. */
  reason: 'cleared' | 'confirmed' | 'closed' | 'timeout';
};

/** Titles Cloudflare and similar interstitials use while checking the browser. */
const CHALLENGE_TITLE =
  /just a moment|attention required|checking your browser|verify you are human|ddos-guard/i;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function launch(opts: AuthOptions): Promise<Browser> {
  const channel = opts.browser ?? 'chrome';
  try {
    return await chromium.launch({
      headless: opts.headless ?? false,
      ...(opts.executablePath
        ? { executablePath: opts.executablePath }
        : { channel }),
      // Look like a normal browser session, not an automated one.
      args: ['--disable-blink-features=AutomationControlled'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
  } catch (err) {
    const message = (err as Error).message;
    if (
      !opts.executablePath &&
      /is not found|executable doesn't exist|not installed/i.test(message)
    ) {
      const name = channel === 'msedge' ? 'Microsoft Edge' : 'Google Chrome';
      const other = channel === 'msedge' ? 'chrome' : 'msedge';
      throw new Error(
        `${name} is not installed. Install it, or try --browser ${other}.`,
        {
          cause: err,
        },
      );
    }
    throw err;
  }
}

/**
 * Open a real browser window on `url` and wait while the person solves a
 * Cloudflare challenge or logs in. Returns the cookies and the browser's
 * User-Agent: clearance cookies only work together with the UA that earned them.
 *
 * Finishes when a `cf_clearance` cookie appears and the page is no longer a
 * challenge, when `done` resolves, when the window is closed, or on timeout.
 */
export async function authenticate(opts: AuthOptions): Promise<AuthResult> {
  const browser = await launch(opts);
  let context: BrowserContext | undefined;
  let cookies: Cookie[] = [];
  let userAgent: string;
  let reason: AuthResult['reason'] = 'timeout';
  let closed = false;
  let confirmed = false;
  browser.on('disconnected', () => (closed = true));
  void opts.done?.then(() => (confirmed = true));

  try {
    context = await browser.newContext({ viewport: null });
    const page = await context.newPage();
    page.on('close', () => (closed = true));
    userAgent = await page.evaluate(() => navigator.userAgent);
    opts.onStatus?.(`Opening ${opts.url}`);
    // Challenge pages often answer 403/503; that's expected, so don't fail on it.
    await page
      .goto(opts.url, { waitUntil: 'domcontentloaded' })
      .catch(() => undefined);

    const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
    let clearedSince: number | undefined;
    while (Date.now() < deadline) {
      if (closed) {
        reason = 'closed';
        break;
      }
      try {
        cookies = await context.cookies();
        const title = await page.title();
        const hasClearance = cookies.some(c => c.name === 'cf_clearance');
        const cleared = hasClearance && !CHALLENGE_TITLE.test(title);
        // Wait a moment after clearance so follow-up cookies are set too.
        clearedSince = cleared ? (clearedSince ?? Date.now()) : undefined;
        if (clearedSince && Date.now() - clearedSince > 1500) {
          reason = 'cleared';
          break;
        }
      } catch {
        // Page navigating or closing; try again on the next tick.
      }
      if (confirmed) {
        cookies = await context.cookies().catch(() => cookies);
        reason = 'confirmed';
        break;
      }
      await sleep(500);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return { cookies, userAgent, reason };
}

export type { Cookie };
