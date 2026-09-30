import { PluginError } from './plugins/errors.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

/**
 * Stable, machine-readable error codes. CLI `--json` output and MCP tool
 * errors carry one of these; renaming one is a breaking change.
 */
export type ErrorCode =
  | 'USAGE'
  | 'INVALID_INPUT'
  | 'PLUGIN_NOT_FOUND'
  | 'CHAPTER_NOT_FOUND'
  | 'NOT_FOLLOWED'
  | 'NO_CHAPTERS'
  | 'NOT_CACHED'
  | 'NEEDS_AUTH'
  | 'NEEDS_CONFIG'
  | 'BUDGET_EXCEEDED'
  | 'PLUGIN_ERROR'
  | 'NETWORK'
  | 'INTERNAL';

export const ERROR_CODES: readonly ErrorCode[] = [
  'USAGE',
  'INVALID_INPUT',
  'PLUGIN_NOT_FOUND',
  'CHAPTER_NOT_FOUND',
  'NOT_FOLLOWED',
  'NO_CHAPTERS',
  'NOT_CACHED',
  'NEEDS_AUTH',
  'NEEDS_CONFIG',
  'BUDGET_EXCEEDED',
  'PLUGIN_ERROR',
  'NETWORK',
  'INTERNAL',
];

/** An error with a stable code and an optional next step for the reader. */
export class LnreaderError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly hint?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'LnreaderError';
  }
}

/**
 * A site answered with a bot check (e.g. Cloudflare) instead of content.
 * Only a person can clear it, with `lnreader auth`.
 */
export class ChallengeError extends LnreaderError {
  constructor(
    readonly host: string,
    readonly url: string,
  ) {
    super(
      'NEEDS_AUTH',
      `${host} answered with a browser check (Cloudflare or similar)`,
      'A person has to run `lnreader auth <plugin>` in a terminal to pass it',
    );
    this.name = 'ChallengeError';
  }
}

/** A host's per-session budget of uncached chapter fetches is used up. */
export class BudgetExceededError extends LnreaderError {
  constructor(
    readonly host: string,
    readonly used: number,
    readonly limit: number,
    readonly needed: number,
  ) {
    super(
      'BUDGET_EXCEEDED',
      `Fetch budget for ${host} is used up (${used} of ${limit} uncached chapters this session; ${needed} more needed)`,
      'Ask the user to raise it with `lnreader config set sessionFetchBudget <n>`; cached chapters stay readable',
    );
    this.name = 'BudgetExceededError';
  }
}

export type ErrorInfo = { code: ErrorCode; message: string; hint?: string };

/** Walk an error and its causes. */
function* chain(err: unknown): Generator<unknown> {
  for (let e = err, depth = 0; e && depth < 8; depth++) {
    yield e;
    e = e instanceof Error ? e.cause : undefined;
  }
}

/**
 * Map any thrown value to `{ code, message, hint }`. The first
 * `LnreaderError` in the cause chain wins, so a bot check inside a plugin
 * call still reports `NEEDS_AUTH`.
 */
export function errorInfo(err: unknown): ErrorInfo {
  const message = err instanceof Error ? err.message : String(err);
  let pluginId: string | undefined;
  for (const e of chain(err)) {
    if (e instanceof PluginError) pluginId ??= e.pluginId;
    if (e instanceof LnreaderError) {
      const hint =
        e instanceof ChallengeError && pluginId
          ? `A person has to run \`lnreader auth ${pluginId}\` in a terminal to pass it`
          : e.hint;
      return { code: e.code, message, hint };
    }
  }
  for (const e of chain(err)) {
    if (e instanceof HttpError)
      return {
        code: 'NETWORK',
        message,
        hint: 'The site returned an error; try again later',
      };
  }
  if (err instanceof PluginError) {
    return {
      code: 'PLUGIN_ERROR',
      message,
      hint: `The source may be down or its plugin broken; \`lnreader plugins test ${err.pluginId}\` checks it`,
    };
  }
  return { code: 'INTERNAL', message };
}
