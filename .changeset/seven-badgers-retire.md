---
'@lnreader/cli': patch
'@lnreader/plugin-runtime': patch
---

Use a Chrome-compatible HTTP transport for plugin requests to improve compatibility with novel sites. The runtime falls back to Node’s built-in fetch when the native transport is unavailable.
