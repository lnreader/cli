# LNReader CLI

Run [LNReader plugins](https://github.com/LNReader/lnreader-plugins) outside the app: search hundreds of web novel sources and download novels as clean EPUB 3 files for Apple Books, Calibre, KOReader, Kobo or Kindle.

The CLI loads the same compiled plugins the app uses, straight from the published plugin index, so plugin fixes reach you without a CLI release.

> **Status:** pre-release. Searching, reading, downloading, following novels, browsing sources, settings, browser sign-in and AI agent support (MCP server and agent skill) all work. Not yet published to npm.

## Install

Requires Node.js 22 or newer.

```bash
# From source (until the npm package is published)
git clone https://github.com/lnreader/cli.git && cd cli
pnpm install
pnpm link:cli              # builds, then puts `lnreader` on your PATH via npm link
lnreader --help
```

After pulling new changes, run `pnpm build` again; the linked command picks up the new build. If `lnreader` is still not found, check that npm's global bin directory (`npm prefix -g`, plus `/bin` on macOS and Linux) is on your `PATH`. To remove it: `npm unlink -g lnreader-cli`.

## Usage

In a terminal, the quickest way is to let the CLI walk you through it:

```bash
lnreader download                      # asks what to search for, then pick a result and options
lnreader search "mother of learning"   # pick a result from the list, then show info or download
```

Results open in a list you can filter by typing. Pick a novel to see its details, then choose **Download**, **Back to results** or **Quit**. Download asks which chapters to include and whether to split into volumes. It then prints the equivalent command, so you can reuse it in scripts.

Everything also works non-interactively with flags. When output is piped, in CI, with `--json` or with `--no-interactive`, `search` prints numbered results instead:

```bash
lnreader search "mother of learning" --plugin royalroad --no-interactive
lnreader info 1                        # a result number from the last search
lnreader download 1                    # writes "<Title>.epub" to the current directory

lnreader download https://www.royalroad.com/fiction/21220/mother-of-learning
lnreader download royalroad:fiction/21220 --from 1 --to 100
lnreader download <novel> --split 100 --out ~/Books   # "Title - Vol 01 (Ch 1-100).epub", ...
lnreader download <novel> --offline    # rebuild from the cache, no network
```

`<novel>` can be:

- a full URL: the plugin is found by matching the URL's host against each plugin's `site`,
- `plugin:path`, e.g. `royalroad:fiction/21220`,
- a path together with `--plugin <id>`,
- a result number from the last `search`.

`download` and `info` with no `<novel>` start the interactive search; `--plugin` and `--lang` narrow which sources it searches.

### Commands

| Command                                  | Purpose                                      | Key flags                                                                           |
| ---------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `plugins list`                           | List available plugins                       | `--lang`, `--search`, `--json`                                                      |
| `plugins repo list / add / remove`       | Manage plugin repo URLs                      |                                                                                     |
| `plugins test <plugin>`                  | Check a source against its live site         | `--json`                                                                            |
| `search <query>`                         | Search one, several or all plugins           | `--plugin`, `--lang`, `--page`, `--limit`, `--json`                                 |
| `info <novel>`                           | Show metadata and chapter count              | `--plugin`, `--chapters`, `--json`                                                  |
| `read <novel> <chapter>`                 | Print a chapter as Markdown or text          | `--format`, `--offset`, `--max-chars`, `--from`, `--to`, `--offline`, `--json`      |
| `download <novel>`                       | Build an EPUB                                | `--from`, `--to`, `--split`, `--out`, `--no-images`, `--offline`, `--css`, `--json` |
| `popular`                                | Browse a source's popular or latest novels   | `--plugin`, `--latest`, `--filter key=value`, `--filters`, `--page`, `--json`       |
| `follow <novel>`                         | Add to your library and download             | `--out`, `--split`, `--no-images`, `--css`, `--no-download`                         |
| `list`                                   | Show followed novels                         | `--json`                                                                            |
| `update [novel...]`                      | Fetch new chapters, rebuild EPUBs            | `--all`, `--delta`, `--json`                                                        |
| `unfollow <novel>`                       | Remove from your library                     |                                                                                     |
| `config get / set / unset / edit / path` | Global and per-plugin settings               | `--plugin`, `--json`                                                                |
| `auth <plugin>`                          | Sign in or pass Cloudflare in a real browser | `--browser chrome\|msedge`, `--browser-path`, `--url`, `--clear`                    |
| `mcp` / `mcp install`                    | MCP server for AI agents / add it to clients | `--client`, `--scope`, `--local`, `--print`                                         |
| `skill install / show / path`            | Agent skill for Claude Code and others       | `--scope`, `--dir`                                                                  |
| `schema [command]`                       | JSON Schema of a command's `--json` output   |                                                                                     |

Global flags: `--home <dir>`, `--refresh` (ignore cached plugin indexes), `--verbose`, `--quiet`, `--no-interactive`, `--no-input`, `--user-agent <ua>`, `--cookies <cookies.txt>`.

### Reading chapters

`read` prints one chapter, or a range, to stdout. The output goes through the same sanitizer as EPUBs, and images stay as links:

```bash
lnreader read royalroad:fiction/21220 1                  # Markdown, chapter name as the first heading
lnreader read <novel> ch:180 --format text               # chapter *number* 180, as plain text
lnreader read <novel> 42 --format numbered               # "[1] paragraph" lines, for citing
lnreader read <novel> 42 --max-chars 20000 --json        # a chunk; pass nextOffset back as --offset
lnreader read <novel> --from 180 --to 220 > arc.md       # a range, separated by headings
```

A chapter can be given as its 1-based index (`42`), its chapter number (`ch:42`), or its path or URL.

### Following novels

`follow` adds a novel to your library and downloads it; `update` later fetches only chapters you don't have yet:

```bash
lnreader follow https://www.royalroad.com/fiction/21220 --out ~/Books --split 100
lnreader list                          # followed novels, new chapters since the last check
lnreader update --all                  # rebuild each book with its new chapters
lnreader update --all --delta          # or: write just the new chapters as "Title - New Chapters (Ch 101-105).epub"
```

Each novel remembers its own output folder and split size. Full rebuilds are fast because chapters come from the cache; with `--split`, only the volumes from the first new chapter onward are rebuilt. `--delta` suits Send-to-Kindle and readers that lose your place when a file is replaced. `update --all` is safe to run from cron: it prints plain progress, keeps going if one novel fails, and exits non-zero if anything failed. `update <novel>` takes a number from `lnreader list`, part of a title, a URL or `plugin:path`. In a terminal, `update` with no arguments lets you pick.

### Browsing sources

```bash
lnreader popular --plugin royalroad                        # popular list
lnreader popular --plugin royalroad --latest --page 2      # latest updates
lnreader popular --plugin royalroad --filters              # which filters it has
lnreader popular --plugin royalroad -f genres=fantasy,-romance -f orderBy=rating
```

Filter values are checked against what the source offers: pickers take one option, checkbox groups a comma list, and excludable groups accept `-option` to exclude.

### Settings

```bash
lnreader config get                        # all settings
lnreader config set outDir ~/Books         # default output folder
lnreader config set minGapMs 1000          # be gentler with sites
lnreader config set sessionFetchBudget 1000  # let agents fetch more chapters per site
lnreader config get --plugin komga         # a plugin's own settings
lnreader config set --plugin komga url https://komga.home.lan
lnreader config edit --plugin komga        # prompt for each setting
lnreader config path                       # where everything is stored
```

### Downloads are resumable

Every chapter is cached on disk as soon as it is fetched. If a download is interrupted, or some chapters fail, run the same command again: cached chapters are reused and only the missing ones are fetched. A failed chapter is retried 3 times, then skipped. The run then ends with a summary and exit code 2.

### Being polite to source sites

By default the CLI makes at most 2 concurrent requests per host with a 500 ms gap between them, backs off exponentially on 429 and 5xx responses, and honours `Retry-After`. Plugins listed in upstream's [`BLACKLIST.json`](https://github.com/LNReader/lnreader-plugins/blob/master/BLACKLIST.json) are hidden and refused.

### Cloudflare-protected sources and logins

Some sites block scripts with a Cloudflare check. `lnreader auth` opens the site in your installed Chrome or Edge, where you pass the check (or log in to an account you have). It saves the cookies together with that browser's User-Agent, which the clearance cookie is tied to:

```bash
npm install -g @lnreader-cli/browser   # one-time: the optional add-on (no browser download)
lnreader auth novelupdates             # finishes by itself once the check clears, or press Enter
lnreader auth novelupdates --browser msedge
lnreader auth novelupdates --clear     # forget the saved cookies
```

Without the add-on, export cookies from your browser as a Netscape `cookies.txt` and pass them with that browser's User-Agent:

```bash
lnreader download <novel> --cookies cookies.txt --user-agent "Mozilla/5.0 ..."
```

Either way the cookies are saved in that plugin's cookie jar, so later runs reuse them. Clearance cookies expire, so run `auth` again when a site starts failing.

## AI agents

Local agents (Claude Code, Claude Desktop, Codex, Cursor and other MCP clients) can search, read and download novels through `lnreader`. The CLI fetches, caches and formats; the agent reads, reasons and writes. This supports recaps, character wikis, update digests and cross-source lookups. It works in three levels:

1. **Agent-friendly CLI.** Any agent with a shell can call `lnreader ... --json`.
2. **MCP server.** `lnreader mcp` exposes typed tools over stdio.
3. **Agent skill.** `skills/lnreader/SKILL.md` teaches agents the workflow, the context budget, politeness rules and recipes.

### MCP server

```bash
lnreader mcp install --client claude-desktop   # or claude-code, cursor; --scope project for this folder only
lnreader mcp install --client claude-code --local   # run this checkout instead of `npx lnreader-cli`
lnreader mcp install --print                   # just print the config entry
```

`mcp install` writes this entry into the client's config and leaves everything else in the file unchanged:

```json
{
  "mcpServers": {
    "lnreader": { "command": "npx", "args": ["-y", "lnreader-cli", "mcp"] }
  }
}
```

| Tool             | Does                                                                        | Writes                     |
| ---------------- | --------------------------------------------------------------------------- | -------------------------- |
| `search_novels`  | Search sources by title, optionally by plugin or language                   | –                          |
| `popular_novels` | A source's popular or latest novels, with its filters                       | –                          |
| `get_novel`      | Metadata and one page (up to 100) of the chapter list                       | –                          |
| `read_chapter`   | One chapter as `md`, `text` or `numbered`, in chunks (default 20,000 chars) | chapter cache              |
| `list_plugins`   | Available sources                                                           | –                          |
| `list_library`   | Followed novels and their new-chapter counts                                | –                          |
| `follow_novel`   | Follow or unfollow a novel                                                  | library                    |
| `update_library` | Check followed novels and cache their new chapters                          | chapter cache              |
| `download_epub`  | Build an EPUB, or with `delta` just the undelivered chapters                | EPUBs in the output folder |
| `test_plugin`    | Check a source step by step: popular, search, novel, chapter                | –                          |

The server also offers the resources `lnreader://library` and `lnreader://novel/{plugin}/{path}`. Read-only tools are marked `readOnlyHint: true`, so clients can auto-approve them and ask before the others.

### Agent skill

```bash
lnreader skill install                 # into ~/.claude/skills/lnreader (Claude Code)
lnreader skill install --scope project # into ./.claude/skills/lnreader
lnreader skill install --dir ~/.codex/skills   # any other skill-aware agent
lnreader skill show                    # print it, e.g. to upload to the Claude app
```

The skill prefers the MCP tools when they are available and falls back to `lnreader ... --json` commands otherwise.

### Scripting and machine-readable output

- **No prompts.** When stdin is not a TTY, or with `--no-input` or `--json`, the CLI never prompts. A missing argument exits with code 2 and a one-line usage error.
- **JSON.** Read commands print one JSON document on stdout with `--json`. `lnreader schema <command>` prints its JSON Schema; breaking changes to these schemas need a major version.
- **Structured errors.** With `--json`, a failure prints `{ "error": { "code", "message", "hint" } }` on stdout. The codes are stable, for example `NEEDS_AUTH`, `BUDGET_EXCEEDED`, `CHAPTER_NOT_FOUND` and `PLUGIN_NOT_FOUND`.
- **Exit codes.** `0` means success. `1` means an error. `2` means a usage error, or some chapters failed while the rest succeeded.
- **Quiet.** `--quiet` drops progress bars and info lines from stderr. Errors still print.

### Guardrails

Every limit lives in `@lnreader-cli/core`, so neither the CLI nor MCP can skip it:

- **Local only.** The MCP server only speaks stdio. There is no HTTP transport, and `lnreader mcp` refuses to start without a client on stdin.
- **Rate limits.** Agent traffic goes through the same per-host limiter as the CLI. Each site also has a **per-session budget of 300 uncached chapter fetches** (`sessionFetchBudget`). Reads from the cache are free. When the budget runs out, tools return `BUDGET_EXCEEDED` until the user raises it. The change takes effect without restarting the server.
- **Bot checks.** A Cloudflare or similar check becomes `NEEDS_AUTH` with instructions for the user to run `lnreader auth <plugin>` in a terminal. The server never opens a browser.
- **File writes.** Only `download_epub` writes files, and only into the configured `outDir` (or `<data dir>/books` when that isn't set). File names come from the novel's title, never from tool input.
- **Context size.** Chapter chunks are capped at 100,000 characters, and chapter lists page at 100.
- **Untrusted text.** Chapter text comes back in a `content` field marked as untrusted. The server instructions and the skill tell agents never to follow instructions found in it.
- **Blacklist and credentials.** Blacklisted sources don't exist as far as agents can tell. Cookies, User-Agents and plugin settings are never returned by any tool.

### Where data lives

Config, cache and data go to the OS-standard directories (e.g. `~/.config/lnreader-cli`, `~/.cache/lnreader-cli` and `~/.local/share/lnreader-cli` on Linux). Set `LNREADER_HOME` or pass `--home <dir>` to keep everything in one folder. Plugin settings, cookies and saved User-Agents are stored with `0600` permissions. There is no telemetry.

## How it works

```
plugins.min.json ──► registry ──► sandbox (node:vm) ──► chapter cache ──► EPUB builder
                                    │
                                    └── shims: @libs/fetch, @libs/storage, cheerio, htmlparser2, dayjs, …
```

- **Registry** fetches plugin indexes (cached 6 hours), drops blacklisted entries and caches each plugin's JS by `id@version`.
- **Sandbox** runs each plugin in its own `vm` context. `require` returns Node versions of the app's modules; anything else fails with `Unshimmed import: <name>`. Plugins get no `process`, `fs` or `Buffer`. Their only network access is the fetch shim, which goes through the rate limiter and the plugin's cookie jar.
- **Library** keeps followed novels, the chapters already delivered and the files written, in SQLite (`node:sqlite`).
- **EPUB builder** sanitizes chapter HTML to XHTML, embeds images (using the plugin's `imageRequestInit`), and writes EPUB 3 with an EPUB 2 NCX. Output is validated with [epubcheck](https://github.com/w3c/epubcheck) in CI.

The code is a pnpm monorepo:

| Package            | Contents                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `packages/core`    | `@lnreader-cli/core`: plugin runtime, fetch layer, storage, EPUB builder                                      |
| `packages/cli`     | `lnreader-cli`, the `lnreader` binary: commands, terminal UI and the MCP server                               |
| `packages/browser` | `@lnreader-cli/browser`: optional add-on for `lnreader auth` (playwright-core driving your installed browser) |

## Development

```bash
pnpm install
pnpm --filter lnreader-cli dev --help   # run the CLI from source
pnpm test                  # unit + end-to-end tests
EPUBCHECK_JAR=/path/to/epubcheck.jar pnpm test   # also validate EPUBs with epubcheck
pnpm lint && pnpm typecheck && pnpm format:check
pnpm check:plugins         # download and load every upstream plugin in the sandbox
```

### Plugin problems

If a source returns nothing or broken chapters, the plugin itself usually needs fixing. Run with `--verbose` to see the plugin's own logs, then report it (or fix it) in [lnreader-plugins](https://github.com/LNReader/lnreader-plugins). That repo's `npm run check:plugin` tests a plugin against its live site. `pnpm check:plugins` here only checks that every published plugin loads in this CLI's sandbox.

## License

[MIT](LICENSE). Plugin types and constants under `packages/core/src/types` are vendored from [LNReader/lnreader-plugins](https://github.com/LNReader/lnreader-plugins) (MIT).
