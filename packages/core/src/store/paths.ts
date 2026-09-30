import { join } from 'node:path';
import envPaths from 'env-paths';

export type Paths = {
  config: string;
  cache: string;
  data: string;
};

/**
 * OS-correct directories. `LNREADER_HOME` puts everything under one folder,
 * which is handy for tests and portable installs.
 */
export function resolvePaths(home = process.env.LNREADER_HOME): Paths {
  if (home) {
    return {
      config: join(home, 'config'),
      cache: join(home, 'cache'),
      data: join(home, 'data'),
    };
  }
  const p = envPaths('lnreader-cli', { suffix: '' });
  return { config: p.config, cache: p.cache, data: p.data };
}
