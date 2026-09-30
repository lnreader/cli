# @lnreader/cli-browser

Optional add-on for [`@lnreader/cli`](https://www.npmjs.com/package/@lnreader/cli) that powers `lnreader auth`. It opens a source site in the Chrome or Edge you already have installed, so you can pass a Cloudflare check or log in, then hands the cookies and the browser's User-Agent back to the CLI.

It uses [`playwright-core`](https://www.npmjs.com/package/playwright-core) to drive your installed browser. **No browser is downloaded.** It is a separate package so the CLI itself stays small and does not depend on Playwright.

## Requirements

- Node.js 22 or newer
- `@lnreader/cli` installed globally
- Google Chrome or Microsoft Edge (or any Chromium-based browser via `--browser-path`)

## Install

Install it globally, next to the CLI:

```bash
npm i -g @lnreader/cli @lnreader/cli-browser
```

## How the CLI picks it up

`lnreader auth` loads this package with a dynamic `import('@lnreader/cli-browser')`, only when you run that command. Because both packages sit in the same global `node_modules`, Node finds the add-on there. If it can't be found, `lnreader auth` prints `npm i -g @lnreader/cli-browser` and exits with code 2; every other command works without it.

```bash
lnreader auth novelupdates                   # finishes by itself once the check clears
lnreader auth novelupdates --browser msedge
lnreader auth novelupdates --browser-path "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
```

The add-on is versioned independently of the CLI.

## API

```js
import { authenticate } from '@lnreader/cli-browser';

const { cookies, userAgent, reason } = await authenticate({
  url: 'https://example.com',
  browser: 'chrome',
});
```

## License

[MIT](LICENSE)
