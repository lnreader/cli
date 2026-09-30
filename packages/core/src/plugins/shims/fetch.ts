import protobuf from 'protobufjs';
import type { CookieJar } from 'tough-cookie';
import type { HttpClient } from '../../net/client.js';
import { currentSignal } from '../context.js';

export type FetchInit = {
  headers?: Record<string, string | undefined> | Headers;
  method?: string;
  body?: FormData | string | URLSearchParams | Uint8Array;
  [key: string]: unknown;
};

type ProtoRequestInit = {
  proto: string;
  requestType: string;
  requestData?: Record<string, unknown>;
  responseType: string;
};

export type FetchShimDeps = {
  http: HttpClient;
  jar: CookieJar;
  /** User-Agent for this plugin's requests (see `lnreader auth`). */
  userAgent?: string;
};

type HeadersInit = ConstructorParameters<typeof Headers>[0];

function toRequestInit(init?: FetchInit): RequestInit {
  if (!init) return {};
  const { headers, ...rest } = init;
  let clean: HeadersInit | undefined;
  if (headers instanceof Headers) clean = headers;
  else if (headers && typeof headers.forEach === 'function')
    clean = headers as unknown as Headers;
  else if (headers) {
    clean = Object.fromEntries(
      Object.entries(headers).filter(
        (e): e is [string, string] => e[1] !== undefined,
      ),
    );
  }
  return { ...(rest as RequestInit), headers: clean };
}

/** `@libs/fetch`, routed through the rate-limited client and the plugin's cookie jar. */
export function createFetchShim({ http, jar, userAgent }: FetchShimDeps) {
  const fetchApi = (url: string, init?: FetchInit): Promise<Response> =>
    http.request(String(url), toRequestInit(init), {
      jar,
      userAgent,
      signal: currentSignal(),
    });

  const fetchText = async (
    url: string,
    init?: FetchInit,
    encoding?: string,
  ): Promise<string> => {
    try {
      const res = await fetchApi(url, init);
      if (!res.ok) return '';
      return new TextDecoder(encoding).decode(await res.arrayBuffer());
    } catch {
      return '';
    }
  };

  const fetchFile = async (url: string, init?: FetchInit): Promise<string> => {
    try {
      const res = await fetchApi(url, init);
      if (!res.ok) return '';
      return Buffer.from(await res.arrayBuffer()).toString('base64');
    } catch {
      return '';
    }
  };

  const fetchProto = async (
    protoInit: ProtoRequestInit,
    url: string,
    init?: FetchInit,
  ) => {
    const root = protobuf.parse(protoInit.proto).root;
    const RequestMessage = root.lookupType(protoInit.requestType);
    if (RequestMessage.verify(protoInit.requestData ?? {}))
      throw new Error('Invalid Proto');
    const encoded = RequestMessage.encode(protoInit.requestData ?? {}).finish();
    // gRPC-web framing: 1 flag byte + 4-byte big-endian length.
    const body = new Uint8Array(5 + encoded.length);
    new DataView(body.buffer).setUint32(1, encoded.length);
    body.set(encoded, 5);
    const res = await fetchApi(url, { method: 'POST', ...init, body });
    const payload = new Uint8Array(await res.arrayBuffer());
    const length = new DataView(payload.buffer, payload.byteOffset).getUint32(
      1,
    );
    return root
      .lookupType(protoInit.responseType)
      .decode(payload.slice(5, 5 + length));
  };

  return { fetchApi, fetchText, fetchFile, fetchProto };
}
