# Architecture

How a plugin from the index becomes an EPUB on disk, and how the code is split into packages.

[← Back to README](../README.md)

The CLI runs [LNReader plugins](https://github.com/LNReader/lnreader-plugins) outside the app. It loads the same compiled plugins the app uses, straight from the published plugin index, so plugin fixes reach you without a CLI release.

## Pipeline

```
plugins.min.json ──► registry ──► sandbox (node:vm) ──► chapter cache ──► EPUB builder
                                    │
                                    └── shims: @libs/fetch, @libs/storage, cheerio, htmlparser2, dayjs, …
```

- **Registry** fetches plugin indexes (cached 6 hours), drops blacklisted entries and caches each plugin's JS by `id@version`.
- **Sandbox** runs each plugin in its own `vm` context. `require` returns Node versions of the app's modules; anything else fails with `Unshimmed import: <name>`. Plugins get no `process`, `fs` or `Buffer`. Their only network access is the fetch shim, which goes through the rate limiter and the plugin's cookie jar.
- **Library** keeps followed novels, the chapters already delivered and the files written, in SQLite (`node:sqlite`).
- **EPUB builder** sanitizes chapter HTML to XHTML, embeds images (using the plugin's `imageRequestInit`), and writes EPUB 3 with an EPUB 2 NCX. Output is validated with [epubcheck](https://github.com/w3c/epubcheck) in CI.

## Packages

The code is a pnpm monorepo:

| Package                   | Contents                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/plugin-runtime` | `@lnreader/plugin-runtime`: plugin runtime, fetch layer, storage, EPUB builder                                |
| `packages/cli`            | `@lnreader/cli`, the `lnreader` binary: commands, terminal UI and the MCP server                              |
| `packages/cli-browser`    | `@lnreader/cli-browser`: optional add-on for `lnreader auth` (playwright-core driving your installed browser) |

Plugin types and constants under `packages/plugin-runtime/src/types` are vendored from [LNReader/lnreader-plugins](https://github.com/LNReader/lnreader-plugins). See [NOTICE](../NOTICE).

Releases are managed with changesets; see [RELEASING.md](../RELEASING.md).
