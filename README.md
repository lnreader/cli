<div align="center">

<!--
  BANNER PLACEHOLDER
  Save the banner as docs/assets/banner-light.png (2000×500, light background)
  and a dark-background version as docs/assets/banner-dark.png, then uncomment
  the <picture> element below. The banner already shows the title and pitch,
  so the <h1> and pitch line under it can go once it is in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/banner-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="docs/assets/banner-light.png">
  <img alt="LNReader CLI" src="docs/assets/banner-light.png" width="800">
</picture>
-->

# LNReader CLI

Search hundreds of web novel sources and download them as clean EPUB files.

[![npm](https://img.shields.io/npm/v/@lnreader/cli?style=flat-square&labelColor=0b1220&color=0f766e)](https://www.npmjs.com/package/@lnreader/cli)
[![Node 22+](https://img.shields.io/badge/node-22%2B-0f766e?style=flat-square&labelColor=0b1220)](https://nodejs.org)
[![MIT](https://img.shields.io/badge/license-MIT-0f766e?style=flat-square&labelColor=0b1220)](LICENSE)

</div>

<!--
  DEMO PLACEHOLDER
  Add docs/assets/demo.gif (a recording of `lnreader download`), then uncomment:

<p align="center"><img alt="Searching for a novel and downloading it as EPUB" src="docs/assets/demo.gif" width="720"></p>
-->

## Quickstart

```bash
npx @lnreader/cli download
```

It asks what to search for, lets you pick a result, then writes an EPUB to the current folder. To keep the `lnreader` command around:

```bash
npm i -g @lnreader/cli
```

Requires Node.js 22 or newer.

> **Status:** pre-release. Searching, reading, downloading, following novels, browsing sources, settings, browser sign-in and AI agent support (MCP server and agent skill) all work.

## What it does

**Find.** Search every source at once, or browse one.

```bash
lnreader search "mother of learning"
lnreader popular --plugin royalroad --latest
```

**Download.** Build an EPUB 3 for Apple Books, Calibre, KOReader, Kobo or Kindle.

```bash
lnreader download https://www.royalroad.com/fiction/21220/mother-of-learning
lnreader download royalroad:fiction/21220 --split 100 --out ~/Books
```

**Read.** Print a chapter, or a range, as Markdown or plain text.

```bash
lnreader read royalroad:fiction/21220 1
```

**Follow.** Keep a library and fetch only the chapters you don't have yet.

```bash
lnreader follow https://www.royalroad.com/fiction/21220 --out ~/Books
lnreader update --all
```

Every command and flag: [docs/commands.md](docs/commands.md).

## Built for AI agents

Claude Code, Claude Desktop, Codex, Cursor and other MCP clients can search, read and download novels through `lnreader`.

```bash
lnreader mcp install --client claude-code   # or claude-desktop, cursor
lnreader skill install                      # the agent skill, for Claude Code
```

Agents get the same rate limits as you, a per-site fetch budget, and no way to write outside your output folder. See [docs/agents.md](docs/agents.md).

## Good to know

- **Polite by default.** Two requests per host at a time, a gap between them, and backoff when a site pushes back.
- **Plugins.** Sources load from the [LNReader plugin index](https://github.com/LNReader/lnreader-plugins), or from any repo you add with `lnreader plugins repo add <url>`.
- **Cloudflare and logins.** `lnreader auth <plugin>` opens your own browser to pass the check. See [docs/auth.md](docs/auth.md).
- **No telemetry.**

## Documentation

| Page                                 | Covers                                                 |
| ------------------------------------ | ------------------------------------------------------ |
| [Commands](docs/commands.md)         | Every command and flag, reading, browsing, settings    |
| [Library](docs/library.md)           | Following and updates, resumable downloads, politeness |
| [Authentication](docs/auth.md)       | Cloudflare checks, logins and cookies                  |
| [AI agents](docs/agents.md)          | MCP server, agent skill, guardrails                    |
| [Scripting](docs/scripting.md)       | JSON output, exit codes, where data lives              |
| [Architecture](docs/architecture.md) | Registry, sandbox, EPUB builder, packages              |
| [Development](docs/development.md)   | Building from source, tests, plugin problems           |

## Disclaimer

LNReader does not have any affiliation with the content providers available.

## License

[MIT](LICENSE)
