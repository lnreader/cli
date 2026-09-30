import { createRequire } from 'node:module';

/**
 * This package's version, read from its package.json at runtime. The path is
 * the same from `src/` and from the bundled `dist/`, one level below the
 * package root.
 */
export const VERSION: string = (
  createRequire(import.meta.url)('../package.json') as { version: string }
).version;
