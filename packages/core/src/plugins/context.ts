import { AsyncLocalStorage } from 'node:async_hooks';

/** Per-call state for async plugin methods, so shims can see the call's abort signal. */
export type CallContext = { signal: AbortSignal };

export const callContext = new AsyncLocalStorage<CallContext>();

export const currentSignal = (): AbortSignal | undefined =>
  callContext.getStore()?.signal;
