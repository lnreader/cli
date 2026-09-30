import { gcm } from '@noble/ciphers/aes.js';
import * as cheerio from 'cheerio';
import dayjs from 'dayjs';
import * as htmlparser2 from 'htmlparser2';
import urlencode from 'urlencode';
import { defaultCover, NovelStatus } from '../../types/constants.js';
import { FilterTypes } from '../../types/filters.js';
import { UnshimmedImportError } from '../errors.js';
import { createFetchShim, type FetchShimDeps } from './fetch.js';
import { PluginStorage, WebStorage } from './storage.js';

export type ShimDeps = FetchShimDeps & {
  /** Path of the plugin's storage.json. */
  storageFile: string;
};

/** Mirrors upstream `isUrlAbsolute` (src/lib/utils.ts). */
export const isUrlAbsolute = (url: string): boolean => {
  if (url) {
    if (url.indexOf('//') === 0) return true;
    if (url.indexOf('://') === -1) return false;
    if (url.indexOf('.') === -1) return false;
    if (url.indexOf('/') === -1) return false;
    if (url.indexOf(':') > url.indexOf('/')) return false;
    if (url.indexOf('://') < url.indexOf('.')) return true;
  }
  return false;
};

/** Builds the module table a single plugin can `require`. */
export function createShims(deps: ShimDeps) {
  const fetchShim = createFetchShim(deps);
  const constants = { NovelStatus, defaultCover };
  const modules: Record<string, unknown> = {
    '@libs/fetch': fetchShim,
    '@libs/storage': {
      storage: new PluginStorage(deps.storageFile),
      localStorage: new WebStorage(),
      sessionStorage: new WebStorage(),
    },
    '@libs/novelStatus': { NovelStatus },
    '@libs/defaultCover': { defaultCover },
    '@libs/filterInputs': { FilterTypes },
    '@libs/isAbsoluteUrl': { isUrlAbsolute },
    '@libs/aes': { gcm },
    '@/types/constants': constants,
    cheerio: cheerio,
    htmlparser2: htmlparser2,
    dayjs: dayjs,
    urlencode: urlencode,
  };
  return { modules, fetch: fetchShim.fetchApi };
}

export function makeRequire(
  pluginId: string,
  modules: Record<string, unknown>,
) {
  return (name: string): unknown => {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new UnshimmedImportError(pluginId, name);
  };
}
