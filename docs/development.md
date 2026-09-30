# Development

Build the CLI from source, run the tests, and track down problems with a source.

[← Back to README](../README.md)

## From source

```bash
git clone https://github.com/lnreader/cli.git && cd cli
pnpm install
pnpm link:cli              # builds, then puts `lnreader` on your PATH via npm link
lnreader --help
```

After pulling new changes, run `pnpm build` again; the linked command picks up the new build. If `lnreader` is still not found, check that npm's global bin directory (`npm prefix -g`, plus `/bin` on macOS and Linux) is on your `PATH`. To remove it: `npm unlink -g @lnreader/cli`.

## Checks

```bash
pnpm install
pnpm --filter @lnreader/cli dev --help   # run the CLI from source
pnpm test                  # unit + end-to-end tests
EPUBCHECK_JAR=/path/to/epubcheck.jar pnpm test   # also validate EPUBs with epubcheck
pnpm lint && pnpm typecheck && pnpm format:check
pnpm build && pnpm pack:check   # pack, install the tarballs in a temp project and run them
pnpm check:plugins         # download and load every upstream plugin in the sandbox
```

Releases are managed with changesets; see [RELEASING.md](../RELEASING.md). For how the pieces fit together, see [Architecture](architecture.md).

## Plugin problems

If a source returns nothing or broken chapters, the plugin itself usually needs fixing. Run with `--verbose` to see the plugin's own logs, then report it (or fix it) in [lnreader-plugins](https://github.com/LNReader/lnreader-plugins). That repo's `npm run check:plugin` tests a plugin against its live site. `pnpm check:plugins` here only checks that every published plugin loads in this CLI's sandbox.

`lnreader plugins test <plugin>` runs the same kind of check from the CLI: popular, search, novel and first chapter against the live site.
