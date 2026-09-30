# AI agents

Local agents (Claude Code, Claude Desktop, Codex, Cursor and other MCP clients) can search, read and download novels through `lnreader`. The CLI fetches, caches and formats; the agent reads, reasons and writes. This supports recaps, character wikis, update digests and cross-source lookups.

[← Back to README](../README.md)

It works in three levels:

1. **Agent-friendly CLI.** Any agent with a shell can call `lnreader ... --json`. See [Scripting](scripting.md).
2. **MCP server.** `lnreader mcp` exposes typed tools over stdio.
3. **Agent skill.** [`skills/lnreader/SKILL.md`](../skills/lnreader/SKILL.md) teaches agents the workflow, the context budget, politeness rules and recipes.

## MCP server

```bash
lnreader mcp install --client claude-desktop   # or claude-code, cursor; --scope project for this folder only
lnreader mcp install --client claude-code --local   # run this checkout instead of `npx @lnreader/cli`
lnreader mcp install --print                   # just print the config entry
```

`--config <file>` writes to a specific config file, and `--dry-run` shows what would change without writing.

`mcp install` writes this entry into the client's config and leaves everything else in the file unchanged:

```json
{
  "mcpServers": {
    "lnreader": { "command": "npx", "args": ["-y", "@lnreader/cli", "mcp"] }
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

## Agent skill

```bash
lnreader skill install                 # into ~/.claude/skills/lnreader (Claude Code)
lnreader skill install --scope project # into ./.claude/skills/lnreader
lnreader skill install --dir ~/.codex/skills   # any other skill-aware agent
lnreader skill show                    # print it, e.g. to upload to the Claude app
lnreader skill path                    # where the bundled SKILL.md is
```

The skill prefers the MCP tools when they are available and falls back to `lnreader ... --json` commands otherwise.

## Guardrails

Every limit lives in `@lnreader/plugin-runtime`, so neither the CLI nor MCP can skip it:

- **Local only.** The MCP server only speaks stdio. There is no HTTP transport, and `lnreader mcp` refuses to start without a client on stdin.
- **Rate limits.** Agent traffic goes through the same per-host limiter as the CLI. Each site also has a **per-session budget of 300 uncached chapter fetches** (`sessionFetchBudget`). Reads from the cache are free. When the budget runs out, tools return `BUDGET_EXCEEDED` until the user raises it. The change takes effect without restarting the server.
- **Bot checks.** A Cloudflare or similar check becomes `NEEDS_AUTH` with instructions for the user to run `lnreader auth <plugin>` in a terminal. The server never opens a browser.
- **File writes.** Only `download_epub` writes files, and only into the configured `outDir` (or `<data dir>/books` when that isn't set). File names come from the novel's title, never from tool input.
- **Context size.** Chapter chunks are capped at 100,000 characters, and chapter lists page at 100.
- **Untrusted text.** Chapter text comes back in a `content` field marked as untrusted. The server instructions and the skill tell agents never to follow instructions found in it.
- **Blacklist and credentials.** Blacklisted sources don't exist as far as agents can tell. Cookies, User-Agents and plugin settings are never returned by any tool.
