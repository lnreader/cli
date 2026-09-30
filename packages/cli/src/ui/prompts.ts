import * as p from '@clack/prompts';

export class MissingArgumentError extends Error {}

/**
 * Prompts only when a person is at the keyboard: both stdin and stdout are
 * TTYs, not in CI, and neither `--json` nor `--no-interactive` was passed.
 */
export function isInteractive(
  opts: { interactive?: boolean; json?: boolean } = {},
): boolean {
  const ci =
    process.env.CI && process.env.CI !== 'false' && process.env.CI !== '0';
  return (
    opts.interactive !== false &&
    !opts.json &&
    !ci &&
    !!process.stdin.isTTY &&
    !!process.stdout.isTTY
  );
}

/** The value, or undefined when the user pressed Esc / Ctrl-C. */
function orUndefined<T>(value: T | symbol): T | undefined {
  return p.isCancel(value) ? undefined : (value as T);
}

/** Ask for a value when interactive; fail with a usage hint otherwise. */
export async function requireText(
  value: string | undefined,
  message: string,
  hint: string,
  opts: { interactive?: boolean; json?: boolean } = {},
) {
  if (value) return value;
  if (!isInteractive(opts)) throw new MissingArgumentError(`Missing ${hint}`);
  const answer = await askText(message, {
    validate: v => (v.trim() ? undefined : 'Required'),
  });
  if (answer === undefined) {
    p.cancel('Cancelled');
    process.exit(130);
  }
  return answer.trim();
}

export async function askText(
  message: string,
  opts: {
    initialValue?: string;
    placeholder?: string;
    validate?: (v: string) => string | undefined;
  } = {},
): Promise<string | undefined> {
  return orUndefined<string>(
    await p.text({
      message,
      initialValue: opts.initialValue,
      placeholder: opts.placeholder,
      validate: opts.validate ? v => opts.validate!(v ?? '') : undefined,
    }),
  );
}

export type Choice<T> = { value: T; label: string; hint?: string };

export async function askSelect<T extends string>(
  message: string,
  options: Choice<T>[],
  initialValue?: T,
): Promise<T | undefined> {
  return orUndefined<T>(
    await p.select<T>({ message, options: options as never, initialValue }),
  );
}

/** Type-to-filter list; matches the label and the hint. */
export async function askSearchable<T extends string>(
  message: string,
  options: Choice<T>[],
  initialValue?: T,
): Promise<T | undefined> {
  return orUndefined<T>(
    await p.autocomplete<T>({
      message,
      options: options as never,
      initialValue,
      maxItems: 12,
      placeholder: 'Type to filter',
      filter: (search, option) =>
        `${option.label ?? ''} ${option.hint ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    }),
  );
}

export function spinner() {
  return p.spinner();
}
