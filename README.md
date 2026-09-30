# LNReader CLI

Run [LNReader plugins](https://github.com/LNReader/lnreader-plugins) outside the app: search hundreds of web novel sources and download novels as clean EPUB 3 files for Apple Books, Calibre, KOReader, Kobo or Kindle.

The CLI loads the same compiled plugins the app uses, straight from the published plugin index, so plugin fixes reach you without a CLI release.

> **Status:** MVP in progress. `plugins`, `search`, `info` and `download` work. `follow`/`update`, `popular`, `config`, `auth` and `test` are planned for v1.

## Install

Requires Node.js 22 or newer.

```bash
# From source (until the npm package is published)
git clone https://github.com/lnreader/cli.git && cd cli
pnpm install && pnpm build
node packages/cli/dist/index.js --help

# Optional: put `lnreader` on your PATH
cd packages/cli && npm link
```

## Usage

```bash
lnreader search "mother of learning" --plugin royalroad
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

Every command works non-interactively. In a terminal, missing arguments are prompted for.

### Commands

| Command                            | Purpose                            | Key flags                                                                           |
| ---------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `plugins list`                     | List available plugins             | `--lang`, `--search`, `--json`                                                      |
| `plugins repo list / add / remove` | Manage plugin repo URLs            |                                                                                     |
| `search <query>`                   | Search one, several or all plugins | `--plugin`, `--lang`, `--page`, `--limit`, `--json`                                 |
| `info <novel>`                     | Show metadata and chapter count    | `--plugin`, `--chapters`, `--json`                                                  |
| `download <novel>`                 | Build an EPUB                      | `--from`, `--to`, `--split`, `--out`, `--no-images`, `--offline`, `--css`, `--json` |

Global flags: `--home <dir>`, `--refresh` (ignore cached plugin indexes), `--verbose`, `--user-agent <ua>`, `--cookies <cookies.txt>`.

### Downloads are resumable

Every chapter is cached on disk as soon as it is fetched. If a download is interrupted, or some chapters fail, run the same command again: cached chapters are reused and only the missing ones are fetched. A failed chapter is retried 3 times, then skipped. The run then ends with a summary and exit code 2.

### Being polite to source sites

By default the CLI makes at most 2 concurrent requests per host with a 500 ms gap between them, backs off exponentially on 429 and 5xx responses, and honours `Retry-After`. Plugins listed in upstream's [`BLACKLIST.json`](https://github.com/LNReader/lnreader-plugins/blob/master/BLACKLIST.json) are hidden and refused.

### Cloudflare-protected sources

Export cookies from a browser where you've passed the challenge (as a Netscape `cookies.txt`), then pass them together with that browser's User-Agent:

```bash
lnreader download <novel> --cookies cookies.txt --user-agent "Mozilla/5.0 ..."
```

The cookies are saved in that plugin's cookie jar, so later runs reuse them. A guided `lnreader auth <plugin>` is planned for v1.

### Where data lives

Config, cache and data go to the OS-standard directories (e.g. `~/.config/lnreader-cli`, `~/.cache/lnreader-cli` and `~/.local/share/lnreader-cli` on Linux). Set `LNREADER_HOME` or pass `--home <dir>` to keep everything in one folder. Plugin settings and cookies are stored with `0600` permissions. There is no telemetry.

## How it works

```
plugins.min.json ──► registry ──► sandbox (node:vm) ──► chapter cache ──► EPUB builder
                                    │
                                    └── shims: @libs/fetch, @libs/storage, cheerio, htmlparser2, dayjs, …
```

- **Registry** fetches plugin indexes (cached 6 hours), drops blacklisted entries and caches each plugin's JS by `id@version`.
- **Sandbox** runs each plugin in its own `vm` context. `require` returns Node versions of the app's modules; anything else fails with `Unshimmed import: <name>`. Plugins get no `process`, `fs` or `Buffer`. Their only network access is the fetch shim, which goes through the rate limiter and the plugin's cookie jar.
- **EPUB builder** sanitizes chapter HTML to XHTML, embeds images (using the plugin's `imageRequestInit`), and writes EPUB 3 with an EPUB 2 NCX. Output is validated with [epubcheck](https://github.com/w3c/epubcheck) in CI.

The code is a pnpm monorepo:

| Package         | Contents                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| `packages/core` | `@lnreader-cli/core`: plugin runtime, fetch layer, storage, EPUB builder |
| `packages/cli`  | `lnreader-cli`, the `lnreader` binary: commands and terminal UI          |

## Development

```bash
pnpm install
pnpm --filter lnreader-cli dev --help   # run the CLI from source
pnpm test                  # unit + end-to-end tests
EPUBCHECK_JAR=/path/to/epubcheck.jar pnpm test   # also validate EPUBs with epubcheck
pnpm lint && pnpm typecheck && pnpm format:check
pnpm check:plugins         # download and load every upstream plugin in the sandbox
```

The legacy Go prototype (`cmd/`, `internal/`) is still in the repository and is not part of the new build.

## License

[MIT](LICENSE). Plugin types and constants under `packages/core/src/types` are vendored from [LNReader/lnreader-plugins](https://github.com/LNReader/lnreader-plugins) (MIT).
