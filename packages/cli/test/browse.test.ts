import { describe, expect, it } from 'vitest';
import { downloadCommand, shellQuote } from '../src/ui/browse.js';
import { isInteractive } from '../src/ui/prompts.js';

describe('downloadCommand', () => {
  it('prints the equivalent non-interactive command', () => {
    expect(
      downloadCommand('royalroad:fiction/21220', {
        from: '3',
        to: '40',
        split: '10',
      }),
    ).toBe(
      'lnreader download royalroad:fiction/21220 --from 3 --to 40 --split 10',
    );
    expect(downloadCommand('x:a', { images: false, out: 'My Books' })).toBe(
      "lnreader download x:a --out 'My Books' --no-images",
    );
  });

  it('quotes shell-sensitive arguments', () => {
    expect(shellQuote('novel/abc?id=1')).toBe("'novel/abc?id=1'");
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('plain-path/1.2')).toBe('plain-path/1.2');
  });
});

describe('isInteractive', () => {
  it('is off without a TTY, with --json or with --no-interactive', () => {
    // Vitest runs without a TTY.
    expect(isInteractive()).toBe(false);
    expect(isInteractive({ json: true })).toBe(false);
    expect(isInteractive({ interactive: false })).toBe(false);
  });
});
