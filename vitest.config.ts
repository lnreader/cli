import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve workspace packages to their TypeScript source, so tests never
  // depend on a prior `pnpm build`.
  resolve: {
    alias: {
      '@lnreader/cli-browser': fileURLToPath(
        new URL('./packages/cli-browser/src/index.ts', import.meta.url),
      ),
      '@lnreader/plugin-runtime': fileURLToPath(
        new URL('./packages/plugin-runtime/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
