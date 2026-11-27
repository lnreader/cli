# @lnreader/plugin-runtime

## 0.1.2

### Patch Changes

- 6e68c08: Use a Chrome-compatible HTTP transport for plugin requests to improve compatibility with novel sites. The runtime falls back to Node’s built-in fetch when the native transport is unavailable.

## 0.1.1

### Patch Changes

- 2a1ab71: Accept self-hosted plugins (such as komga) whose `site` is undefined until their URL setting is configured.

## 0.1.0

### Minor Changes

- 179fac8: Initial release: `@lnreader/cli` (the `lnreader` command, including `lnreader mcp`), `@lnreader/plugin-runtime` (plugin runtime, fetch layer, storage and EPUB builder) and the optional `@lnreader/cli-browser` add-on for `lnreader auth`.
