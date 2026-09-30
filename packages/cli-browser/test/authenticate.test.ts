import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticate } from '../src/index.js';

// Playwright's bundled Chromium where available (e.g. CI images); skipped otherwise.
const CHROMIUM =
  process.env.LNREADER_TEST_CHROMIUM ?? '/opt/pw-browsers/chromium';

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const html = (title: string, body = '') => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><title>${title}</title>${body}`);
    };
    if (req.url === '/') {
      // Imitates a Cloudflare interstitial that clears after a moment.
      return html(
        'Just a moment...',
        `<script>setTimeout(() => location.href = '/clear', 300)</script>`,
      );
    }
    if (req.url === '/clear') {
      res.writeHead(302, {
        location: '/home',
        'set-cookie': [
          'cf_clearance=ok123; Path=/; HttpOnly',
          'session=abc; Path=/',
        ],
      });
      return res.end();
    }
    if (req.url === '/plain') return html('Welcome');
    return html('Home');
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server?.close());

describe.skipIf(!existsSync(CHROMIUM))('authenticate', () => {
  it('finishes once the challenge clears and returns cookies with the UA', async () => {
    const result = await authenticate({
      url: `${base}/`,
      executablePath: CHROMIUM,
      headless: true,
      timeoutMs: 20_000,
    });
    expect(result.reason).toBe('cleared');
    expect(result.cookies.map(c => c.name).sort()).toEqual([
      'cf_clearance',
      'session',
    ]);
    expect(result.userAgent).toMatch(/Mozilla\/5\.0/);
  }, 30_000);

  it('waits for confirmation on pages without a challenge', async () => {
    let confirm!: () => void;
    const done = new Promise<void>(r => (confirm = r));
    setTimeout(() => confirm(), 1500);
    const result = await authenticate({
      url: `${base}/plain`,
      executablePath: CHROMIUM,
      headless: true,
      done,
      timeoutMs: 20_000,
    });
    expect(result.reason).toBe('confirmed');
  }, 30_000);

  it('explains a missing browser', async () => {
    await expect(
      authenticate({
        url: base,
        executablePath: '/nonexistent/chrome',
        headless: true,
      }),
    ).rejects.toThrow();
  });
});
