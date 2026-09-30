import * as p from '@clack/prompts';
import { isTTY } from './format.js';

export class MissingArgumentError extends Error {}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Cancelled');
    process.exit(130);
  }
  return value as T;
}

/** Ask for a value in a TTY; fail with a usage hint when non-interactive. */
export async function requireText(
  value: string | undefined,
  message: string,
  hint: string,
) {
  if (value) return value;
  if (!isTTY()) throw new MissingArgumentError(`Missing ${hint}`);
  return unwrap<string>(
    await p.text({
      message,
      validate: v => (v?.trim() ? undefined : 'Required'),
    }),
  ).trim();
}

export async function select<T extends string>(
  message: string,
  options: Array<{ value: T; label: string; hint?: string }>,
): Promise<T> {
  return unwrap(await p.select({ message, options: options as never })) as T;
}

export async function confirm(
  message: string,
  initialValue = true,
): Promise<boolean> {
  return unwrap<boolean>(await p.confirm({ message, initialValue }));
}
