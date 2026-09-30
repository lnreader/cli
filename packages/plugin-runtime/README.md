# @lnreader/plugin-runtime

The engine behind [`@lnreader/cli`](https://www.npmjs.com/package/@lnreader/cli): runs [LNReader plugins](https://github.com/LNReader/lnreader-plugins) in Node and builds EPUBs from them. It contains:

- **Plugin registry and loader**: fetches plugin indexes, honours the upstream blacklist and caches each plugin's code by `id@version`.
- **Sandbox**: runs each plugin in its own `vm` context with Node versions of the app's modules; its only network access is the fetch shim.
- **Fetch layer**: per-host rate limiting, retries with backoff, `Retry-After`, per-plugin cookie jars and a session fetch budget.
- **Storage**: config, chapter cache and a library of followed novels in SQLite (`node:sqlite`, no native modules).
- **EPUB builder**: sanitizes chapter HTML to XHTML, embeds images and writes EPUB 3.

Most people want the CLI instead: `npx @lnreader/cli --help`.

## Requirements

Node.js 22 or newer. ESM only.

## Install

```bash
npm i @lnreader/plugin-runtime
```

## Example

```js
import { createRuntime } from '@lnreader/plugin-runtime';

const rt = await createRuntime();
try {
  const runner = await rt.loader.load('royalroad');
  const [novel] = await runner.searchNovels('mother of learning', 1);
  console.log(novel);
} finally {
  await rt.close();
}
```

Types ship with the package. The API is pre-1.0 and may change between minor versions.

## License

[MIT](LICENSE). Plugin types and constants under `src/types` are vendored from [LNReader/lnreader-plugins](https://github.com/LNReader/lnreader-plugins) (MIT).
