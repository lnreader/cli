import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Write a file via temp + rename so an interrupted process never leaves a torn file. */
export async function writeFileAtomic(
  path: string,
  data: string | Uint8Array,
  mode = 0o644,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, data, { mode });
  await rename(tmp, path);
}

export async function readJson<T = unknown>(
  path: string,
): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export function writeJson(
  path: string,
  value: unknown,
  mode = 0o644,
): Promise<void> {
  return writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n', mode);
}
