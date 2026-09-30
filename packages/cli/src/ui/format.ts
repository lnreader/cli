import pc from 'picocolors';

/** Human output goes to stdout; diagnostics go to stderr so `--json` stays clean. */
export const out = (line = ''): void => void process.stdout.write(line + '\n');
export const err = (line = ''): void => void process.stderr.write(line + '\n');

let quiet = false;

/** `--quiet`: drop progress and info lines on stderr; errors still print. */
export function setQuiet(value: boolean): void {
  quiet = value;
}

export const isQuiet = (): boolean => quiet;

const unlessQuiet =
  (line: (m: string) => string) =>
  (m: string): void => {
    if (!quiet) err(line(m));
  };

export const log = {
  info: unlessQuiet(m => `${pc.cyan('•')} ${m}`),
  success: unlessQuiet(m => `${pc.green('✔')} ${m}`),
  warn: unlessQuiet(m => `${pc.yellow('!')} ${m}`),
  error: (m: string) => err(`${pc.red('✖')} ${m}`),
  /** The next step after an error; shown even with `--quiet`. */
  hint: (m: string) => err(`  ${pc.dim(m)}`),
};

export function printJson(value: unknown): void {
  out(JSON.stringify(value, null, 2));
}

// eslint-disable-next-line no-control-regex
const visible = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

/** Width in terminal columns: wide (CJK) characters count double. */
function width(s: string): number {
  let w = 0;
  for (const ch of visible(s)) {
    const cp = ch.codePointAt(0)!;
    w += cp >= 0x1100 && /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦]/u.test(ch) ? 2 : 1;
  }
  return w;
}

export function truncate(s: string, max: number): string {
  if (width(s) <= max) return s;
  let outStr = '';
  for (const ch of s) {
    if (width(outStr + ch) > max - 1) break;
    outStr += ch;
  }
  return outStr + '…';
}

/** Simple left-aligned table. Columns after the first `maxWidths` entries are unbounded. */
export function table(rows: string[][], maxWidths: number[] = []): string {
  if (rows.length === 0) return '';
  const cells = rows.map(r =>
    r.map((c, i) => (maxWidths[i] ? truncate(c, maxWidths[i]) : c)),
  );
  const widths = cells[0]!.map((_, i) =>
    Math.max(...cells.map(r => width(r[i] ?? ''))),
  );
  return cells
    .map(r =>
      r
        .map((c, i) =>
          i === r.length - 1 ? c : c + ' '.repeat(widths[i]! - width(c)),
        )
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}
