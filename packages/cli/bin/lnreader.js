#!/usr/bin/env node
// Stable entry point for `npm link` and the published package: it exists even
// before `dist/` is built, so the `lnreader` command always gets installed.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const entry = new URL('../dist/index.js', import.meta.url);
if (!existsSync(fileURLToPath(entry))) {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  console.error(
    `lnreader is not built yet. Run this in ${root}:\n\n  pnpm install && pnpm build\n`,
  );
  process.exit(1);
}
await import(entry.href);
