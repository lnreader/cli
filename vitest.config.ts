import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve workspace packages to their TypeScript source, so tests never
  // depend on a prior `pnpm build`.
  resolve: { conditions: ['source'] },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
