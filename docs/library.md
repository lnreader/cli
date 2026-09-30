# Library

Follow novels, keep them up to date, and pick up interrupted downloads where they stopped. This page also covers how the CLI keeps its traffic light on source sites.

[← Back to README](../README.md)

## Following novels

`follow` adds a novel to your library and downloads it; `update` later fetches only chapters you don't have yet:

```bash
lnreader follow https://www.royalroad.com/fiction/21220 --out ~/Books --split 100
lnreader list                          # followed novels, new chapters since the last check
lnreader update --all                  # rebuild each book with its new chapters
lnreader update --all --delta          # or: write just the new chapters as "Title - New Chapters (Ch 101-105).epub"
```

Each novel remembers its own output folder and split size. Full rebuilds are fast because chapters come from the cache; with `--split`, only the volumes from the first new chapter onward are rebuilt. `--delta` suits Send-to-Kindle and readers that lose your place when a file is replaced.

`update --all` is safe to run from cron: it prints plain progress, keeps going if one novel fails, and exits non-zero if anything failed.

`update <novel>` takes a number from `lnreader list`, part of a title, a URL or `plugin:path`. In a terminal, `update` with no arguments lets you pick.

`unfollow <novel>` removes a novel from your library. Its EPUBs are kept.

## Downloads are resumable

Every chapter is cached on disk as soon as it is fetched. If a download is interrupted, or some chapters fail, run the same command again: cached chapters are reused and only the missing ones are fetched. A failed chapter is retried 3 times, then skipped. The run then ends with a summary and exit code 2.

## Being polite to source sites

By default the CLI makes at most 2 concurrent requests per host with a 500 ms gap between them, backs off exponentially on 429 and 5xx responses, and honours `Retry-After`. Raise the gap with `lnreader config set minGapMs <ms>`.

Plugins listed in upstream's [`BLACKLIST.json`](https://github.com/LNReader/lnreader-plugins/blob/master/BLACKLIST.json) are hidden and refused.
