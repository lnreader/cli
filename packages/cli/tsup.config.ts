import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Optional add-on, loaded only by `lnreader auth` when installed.
  external: ['@lnreader-cli/browser'],
  sourcemap: true,
  banner: { js: '#!/usr/bin/env node' },
  define: {
    __VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
});
