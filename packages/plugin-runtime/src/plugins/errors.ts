export class UnshimmedImportError extends Error {
  constructor(
    readonly pluginId: string,
    readonly moduleName: string,
  ) {
    super(`Unshimmed import: ${moduleName} (plugin ${pluginId})`);
    this.name = 'UnshimmedImportError';
  }
}

export class PluginError extends Error {
  constructor(
    readonly pluginId: string,
    readonly method: string,
    cause: unknown,
  ) {
    super(`${pluginId}.${method} failed: ${describe(cause)}`, { cause });
    this.name = 'PluginError';
  }
}

/** Message plus nested causes, e.g. "fetch failed: connect ECONNREFUSED". */
export function describe(err: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = err, depth = 0; e && depth < 4; depth++) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg && !parts.includes(msg)) parts.push(msg);
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(': ') || 'unknown error';
}

export class InvalidPluginError extends Error {
  constructor(pluginId: string, reason: string) {
    super(`Plugin ${pluginId} is invalid: ${reason}`);
    this.name = 'InvalidPluginError';
  }
}
