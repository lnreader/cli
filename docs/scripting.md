# Scripting

Use `lnreader` from shell scripts, cron jobs and other programs. This page covers prompts, JSON output, errors, exit codes and where files are kept.

[← Back to README](../README.md)

## Machine-readable output

- **No prompts.** When stdin is not a TTY, or with `--no-input` or `--json`, the CLI never prompts. A missing argument exits with code 2 and a one-line usage error.
- **JSON.** Read commands print one JSON document on stdout with `--json`. `lnreader schema <command>` prints its JSON Schema; breaking changes to these schemas need a major version.
- **Structured errors.** With `--json`, a failure prints `{ "error": { "code", "message", "hint" } }` on stdout. The codes are stable, for example `NEEDS_AUTH`, `BUDGET_EXCEEDED`, `CHAPTER_NOT_FOUND` and `PLUGIN_NOT_FOUND`.
- **Quiet.** `--quiet` drops progress bars and info lines from stderr. Errors still print.

## Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| `0`  | Success                                                         |
| `1`  | An error                                                        |
| `2`  | A usage error, or some chapters failed while the rest succeeded |

## Where data lives

Config, cache and data go to the OS-standard directories (e.g. `~/.config/lnreader-cli`, `~/.cache/lnreader-cli` and `~/.local/share/lnreader-cli` on Linux). Set `LNREADER_HOME` or pass `--home <dir>` to keep everything in one folder. `lnreader config path` prints the locations in use.

Plugin settings, cookies and saved User-Agents are stored with `0600` permissions. There is no telemetry.
