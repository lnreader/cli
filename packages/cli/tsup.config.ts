import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
});
