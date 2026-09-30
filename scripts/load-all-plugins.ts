/**
 * Download every plugin in the configured repos and load it in the sandbox.
 * Catches unshimmed imports and constructor failures without touching any
 * source site. Exits non-zero if any plugin fails to load.
 *
 *   pnpm check:plugins [--refresh]
 */
import { join } from 'node:path';
import { createRuntime, loadPlugin } from '@lnreader/plugin-runtime';

const rt = await createRuntime({ logger: { debug: () => {}, warn: () => {} } });
const entries = await rt.registry.list(process.argv.includes('--refresh'));
const failures: string[] = [];

for (const entry of entries) {
  try {
    const code = await rt.registry.getCode(entry);
    loadPlugin(code, entry.id, {
      http: rt.http,
      jar: await rt.cookies.jar(entry.id),
      storageFile: join(rt.paths.data, 'plugins', entry.id, 'storage.json'),
    });
  } catch (e) {
    failures.push(`${entry.id}: ${(e as Error).message}`);
  }
}

console.log(
  `${entries.length - failures.length}/${entries.length} plugins loaded`,
);
if (failures.length) {
  console.log(failures.join('\n'));
  process.exit(1);
}
