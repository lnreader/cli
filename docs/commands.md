# Commands

How to point `lnreader` at a novel, and every command and flag it accepts. Run `lnreader <command> --help` for the same information in your terminal.

[← Back to README](../README.md)

## Interactive and non-interactive use

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

## Naming a novel

`<novel>` can be:

- a full URL: the plugin is found by matching the URL's host against each plugin's `site`,
- `plugin:path`, e.g. `royalroad:fiction/21220`,
- a path together with `--plugin <id>`,
- a result number from the last `search`.

`download` and `info` with no `<novel>` start the interactive search; `--plugin` and `--lang` narrow which sources it searches.

## Reference

| Command                                  | Purpose                                      | Flags                                                                                                                 |
| ---------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `plugins list`                           | List available plugins                       | `--lang`, `--search`, `--json`                                                                                        |
| `plugins repo list / add / remove`       | Manage plugin repo URLs                      |                                                                                                                       |
| `plugins test <plugin>`                  | Check a source against its live site         | `--json`                                                                                                              |
| `search <query>`                         | Search one, several or all plugins           | `--plugin`, `--lang`, `--page`, `--limit`, `--json`                                                                   |
| `info <novel>`                           | Show metadata and chapter count              | `--plugin`, `--lang`, `--chapters`, `--json`                                                                          |
| `read <novel> <chapter>`                 | Print a chapter as Markdown or text          | `--plugin`, `--format`, `--offset`, `--max-chars`, `--from`, `--to`, `--offline`, `--json`                            |
| `download <novel>`                       | Build an EPUB                                | `--plugin`, `--lang`, `--from`, `--to`, `--split`, `--out`, `--format`, `--no-images`, `--offline`, `--css`, `--json` |
| `popular`                                | Browse a source's popular or latest novels   | `--plugin`, `--latest`, `--filter key=value`, `--filters`, `--page`, `--lang`, `--json`                               |
| `follow <novel>`                         | Add to your library and download             | `--plugin`, `--lang`, `--out`, `--split`, `--no-images`, `--css`, `--no-download`, `--json`                           |
| `list` (alias `library`)                 | Show followed novels                         | `--json`                                                                                                              |
| `update [novel...]`                      | Fetch new chapters, rebuild EPUBs            | `--all`, `--delta`, `--json`                                                                                          |
| `unfollow <novel>`                       | Remove from your library (EPUBs are kept)    | `--plugin`, `--json`                                                                                                  |
| `config get / set / unset / edit / path` | Global and per-plugin settings               | `--plugin`, `--json` (`get` only)                                                                                     |
| `auth <plugin>`                          | Sign in or pass Cloudflare in a real browser | `--browser chrome\|msedge`, `--browser-path`, `--url`, `--timeout`, `--clear`                                         |
| `mcp` / `mcp install`                    | MCP server for AI agents / add it to clients | `--client`, `--scope`, `--local`, `--config`, `--print`, `--dry-run`, `--json`                                        |
| `skill install / show / path`            | Agent skill for Claude Code and others       | `--scope`, `--dir`, `--json`                                                                                          |
| `schema [command]`                       | JSON Schema of a command's `--json` output   | `--json`                                                                                                              |

Short forms: `-p` for `--plugin`, `-o` for `--out`, `-f` for `--filter`, `-a` for `--all`. `search --plugin` takes several ids. `download --format` accepts only `epub` today.

Global flags: `--home <dir>`, `--refresh` (ignore cached plugin indexes), `--verbose` (`-v`), `--quiet` (`-q`), `--no-interactive`, `--no-input`, `--user-agent <ua>`, `--cookies <cookies.txt>`, `--version` (`-V`).

## Reading chapters

`read` prints one chapter, or a range, to stdout. The output goes through the same sanitizer as EPUBs, and images stay as links:

```bash
lnreader read royalroad:fiction/21220 1                  # Markdown, chapter name as the first heading
lnreader read <novel> ch:180 --format text               # chapter *number* 180, as plain text
lnreader read <novel> 42 --format numbered               # "[1] paragraph" lines, for citing
lnreader read <novel> 42 --max-chars 20000 --json        # a chunk; pass nextOffset back as --offset
lnreader read <novel> --from 180 --to 220 > arc.md       # a range, separated by headings
```

A chapter can be given as its 1-based index (`42`), its chapter number (`ch:42`), or its path or URL. `--format` also accepts `html`.

## Browsing sources

```bash
lnreader popular --plugin royalroad                        # popular list
lnreader popular --plugin royalroad --latest --page 2      # latest updates
lnreader popular --plugin royalroad --filters              # which filters it has
lnreader popular --plugin royalroad -f genres=fantasy,-romance -f orderBy=rating
```

Filter values are checked against what the source offers: pickers take one option, checkbox groups a comma list, and excludable groups accept `-option` to exclude.

## Settings

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

## Plugin repos

Plugins come from the published LNReader plugin index by default. Add any other index with `lnreader plugins repo add <url>`, where `<url>` points to a `plugins.min.json`. `plugins repo list` shows what is configured and `plugins repo remove <url>` drops one.
