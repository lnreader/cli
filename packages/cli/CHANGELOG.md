# @lnreader/cli

## 0.1.2

### Patch Changes

- 6e68c08: Use a Chrome-compatible HTTP transport for plugin requests to improve compatibility with novel sites. The runtime falls back to Node’s built-in fetch when the native transport is unavailable.
- Updated dependencies [6e68c08]
  - @lnreader/plugin-runtime@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [2a1ab71]
  - @lnreader/plugin-runtime@0.1.1

## 0.1.0

### Minor Changes

- 179fac8: Initial release: `@lnreader/cli` (the `lnreader` command, including `lnreader mcp`), `@lnreader/plugin-runtime` (plugin runtime, fetch layer, storage and EPUB builder) and the optional `@lnreader/cli-browser` add-on for `lnreader auth`.

### Patch Changes

- Updated dependencies [179fac8]
  - @lnreader/plugin-runtime@0.1.0
