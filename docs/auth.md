# Authentication

Some sites block scripts with a Cloudflare check, and some need an account. This page shows how to get past both with your own browser, or with exported cookies.

[← Back to README](../README.md)

## Signing in with `lnreader auth`

`lnreader auth` opens the site in your installed Chrome or Edge, where you pass the check (or log in to an account you have). It saves the cookies together with that browser's User-Agent, which the clearance cookie is tied to:

```bash
npm i -g @lnreader/cli-browser         # one-time: the optional add-on (no browser download)
lnreader auth novelupdates             # finishes by itself once the check clears, or press Enter
lnreader auth novelupdates --browser msedge
lnreader auth novelupdates --clear     # forget the saved cookies
```

Other flags: `--browser-path <path>` for another Chromium-based browser such as Brave, `--url <url>` to open a different page than the plugin's site, and `--timeout <minutes>` (default 10).

## Using exported cookies

Without the add-on, export cookies from your browser as a Netscape `cookies.txt` and pass them with that browser's User-Agent:

```bash
lnreader download <novel> --cookies cookies.txt --user-agent "Mozilla/5.0 ..."
```

## How cookies are kept

Either way the cookies are saved in that plugin's cookie jar, so later runs reuse them. Clearance cookies expire, so run `auth` again when a site starts failing.

Cookies and saved User-Agents are stored with `0600` permissions. See [Scripting](scripting.md#where-data-lives) for where.
