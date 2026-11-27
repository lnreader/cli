import type { RequestInit as ImpitRequestInit } from 'impit';
import { DEFAULT_USER_AGENT } from '../store/config.js';
import type { FetchLike } from './client.js';

type HeadersInit = ConstructorParameters<typeof Headers>[0];

export function toHeaders(init: HeadersInit | undefined): Headers {
  const headers = new Headers();
  if (init) {
    const source =
      init instanceof Headers ? init : new Headers(init as HeadersInit);
    source.forEach((v, k) => headers.set(k, v));
  }
  return headers;
}

function secFetchSite(url: string, headers: Headers): string {
  const source = headers.get('origin') ?? headers.get('referer');
  if (!source) return 'none';
  try {
    return new URL(source).origin === new URL(url).origin
      ? 'same-origin'
      : 'cross-site';
  } catch {
    return 'same-origin';
  }
}

/**
 * Adjusts only context-dependent headers (`Sec-Fetch-*` and custom
 * `User-Agent` overrides) while leaving static browser headers (`Accept`,
 * `Accept-Encoding`, `Accept-Language`, `Priority`, `Sec-CH-UA*`, `User-Agent`)
 * to impit's browser profile.
 */
function adaptHeaders(
  url: string,
  method: string,
  init: HeadersInit | undefined,
): Headers {
  const headers = toHeaders(init);
  const ua = headers.get('user-agent');
  if (ua === DEFAULT_USER_AGENT) {
    headers.delete('user-agent');
  } else if (ua) {
    for (const h of ['sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform']) {
      if (!headers.has(h)) headers.set(h, '');
    }
  }

  if (!headers.has('sec-fetch-site')) {
    headers.set('sec-fetch-site', secFetchSite(url, headers));
  }

  const accept = headers.get('accept');
  const isImage = method === 'GET' && !!accept?.startsWith('image/');
  const isXhr =
    !isImage &&
    (method !== 'GET' ||
      headers.has('x-requested-with') ||
      headers.has('origin') ||
      headers.has('content-type') ||
      headers.has('authorization') ||
      (accept !== null && !accept.includes('text/html')));

  if (isImage) {
    if (!headers.has('sec-fetch-mode'))
      headers.set('sec-fetch-mode', 'no-cors');
    if (!headers.has('sec-fetch-dest')) headers.set('sec-fetch-dest', 'image');
    if (!headers.has('sec-fetch-user')) headers.set('sec-fetch-user', '');
    if (!headers.has('upgrade-insecure-requests'))
      headers.set('upgrade-insecure-requests', '');
  } else if (isXhr) {
    if (!headers.has('accept')) headers.set('accept', '*/*');
    if (!headers.has('sec-fetch-mode')) headers.set('sec-fetch-mode', 'cors');
    if (!headers.has('sec-fetch-dest')) headers.set('sec-fetch-dest', 'empty');
    if (!headers.has('sec-fetch-user')) headers.set('sec-fetch-user', '');
    if (!headers.has('upgrade-insecure-requests'))
      headers.set('upgrade-insecure-requests', '');
  }
  return headers;
}

const FALLBACK_HEADERS: Record<string, string> = {
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Mode': 'cors',
};

export function createImpitFetch(
  load: () => Promise<typeof import('impit')> = () => import('impit'),
): FetchLike {
  let implPromise: Promise<FetchLike> | undefined;
  const resolveImpl = (): Promise<FetchLike> =>
    (implPromise ??= (async (): Promise<FetchLike> => {
      try {
        const { Impit } = await load();
        const impit = new Impit({ browser: 'chrome151', timeout: null });
        return (input, init = {}) => {
          const method = (init.method ?? 'GET').toUpperCase();
          return impit.fetch(input, {
            ...(init as ImpitRequestInit),
            headers: adaptHeaders(input, method, init.headers),
          }) as unknown as Promise<Response>;
        };
      } catch {
        return (input, init = {}) => {
          const headers = toHeaders(init.headers);
          for (const [k, v] of Object.entries(FALLBACK_HEADERS)) {
            if (!headers.has(k)) headers.set(k, v);
          }
          return globalThis.fetch(input, { ...init, headers });
        };
      }
    })());

  return async (input, init) => (await resolveImpl())(input, init);
}
