import { chmod, cp } from 'node:fs/promises';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  // Without the typecheck-only `paths`, so workspace packages resolve to
  // their published builds and stay external instead of being bundled.
  tsconfig: 'tsconfig.build.json',
  clean: true,
  sourcemap: true,
  // Bundle only this package's own source; every dependency stays an import.
  skipNodeModulesBundle: true,
  // Optional add-on, loaded with a dynamic import() by `lnreader auth` when
  // installed. It is only a devDependency, so it must be marked external.
  external: ['@lnreader/cli-browser'],
  banner: { js: '#!/usr/bin/env node' },
  onSuccess: async () => {
    // Ship the agent skill with the package for `lnreader skill install`.
    await cp('../../skills', 'dist/skills', { recursive: true });
    // The `lnreader` bin must be executable (a no-op on Windows).
    await chmod('dist/index.js', 0o755);
  },
});
