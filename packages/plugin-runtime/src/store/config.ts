import { join } from 'node:path';
import { z } from 'zod';
import { DEFAULT_SESSION_FETCH_BUDGET } from '../net/budget.js';
import { readJson, writeJson } from './fs.js';
import type { Paths } from './paths.js';

export const BLACKLIST_URL =
  'https://raw.githubusercontent.com/LNReader/lnreader-plugins/master/BLACKLIST.json';

export const DEFAULT_REPO =
  'https://raw.githubusercontent.com/LNReader/lnreader-plugins/plugins/v3.0.0/.dist/plugins.min.json';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const ConfigSchema = z.object({
  repos: z.array(z.url()).default([DEFAULT_REPO]),
  /** Upstream BLACKLIST.json; plugins listed there are hidden and refused. */
  blacklistUrl: z.url().default(BLACKLIST_URL),
  userAgent: z.string().default(DEFAULT_USER_AGENT),
  /** Max concurrent requests per host. */
  concurrency: z.number().int().min(1).max(16).default(2),
  /** Minimum gap between request starts on one host, in ms. */
  minGapMs: z.number().int().min(0).default(500),
  /**
   * Uncached chapter fetches an MCP session or `lnreader read` may make per
   * host before stopping with BUDGET_EXCEEDED. Cached reads are free.
   */
  sessionFetchBudget: z
    .number()
    .int()
    .min(1)
    .default(DEFAULT_SESSION_FETCH_BUDGET),
  /** Per-call timeout for async plugin methods, in ms. */
  pluginTimeoutMs: z.number().int().min(1000).default(60_000),
  /** Default output directory for EPUBs; cwd when unset. */
  outDir: z.string().optional(),
  /** Path to a CSS file that replaces the default stylesheet. */
  css: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function configFile(paths: Paths): string {
  return join(paths.config, 'config.json');
}

export async function loadConfig(paths: Paths): Promise<Config> {
  const raw = (await readJson(configFile(paths))) ?? {};
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid config at ${configFile(paths)}: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export async function saveConfig(paths: Paths, config: Config): Promise<void> {
  await writeJson(configFile(paths), ConfigSchema.parse(config), 0o600);
}
