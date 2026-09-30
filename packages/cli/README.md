# @lnreader/cli

Run [LNReader plugins](https://github.com/LNReader/lnreader-plugins) outside the app: search hundreds of web novel sources, read chapters in the terminal and download novels as clean EPUB 3 files. Installs the `lnreader` command, which also runs an MCP server (`lnreader mcp`) for AI agents.

## Requirements

Node.js 22 or newer. No native modules, so there is nothing to compile.

## Install

Run it once without installing:

```bash
npx @lnreader/cli --help
npx @lnreader/cli search "mother of learning"
```

Or install it globally, which puts the `lnreader` command on your `PATH`:

```bash
npm i -g @lnreader/cli
lnreader --help
lnreader --version
```

## Usage

```bash
lnreader download                      # interactive: search, pick a result, download
lnreader search "mother of learning" --plugin royalroad --no-interactive
lnreader info 1                        # a result number from the last search
lnreader download 1                    # writes "<Title>.epub" to the current directory
lnreader plugins list --json           # every command has --json for scripts and agents
```

### Cloudflare-protected sources

`lnreader auth <plugin>` opens the site in your installed Chrome or Edge so you can pass a Cloudflare check or log in. It needs the optional add-on [`@lnreader/cli-browser`](https://www.npmjs.com/package/@lnreader/cli-browser):

```bash
npm i -g @lnreader/cli-browser
```

Without it, `lnreader auth` prints that command and exits with code 2. You can also pass `--cookies <cookies.txt> --user-agent "<ua>"` instead.

### AI agents

```bash
lnreader mcp install --client claude-code   # or claude-desktop, cursor
lnreader skill install                      # the agent skill for Claude Code
```

Or add it to any MCP client by hand:

```json
{
  "mcpServers": {
    "lnreader": { "command": "npx", "args": ["-y", "@lnreader/cli", "mcp"] }
  }
}
```

See the [full documentation](https://github.com/lnreader/cli#readme) for every command, the library, configuration and exit codes.

## License

[MIT](LICENSE)
