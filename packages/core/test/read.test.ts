import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  ChallengeError,
  errorInfo,
  FetchBudget,
  findChapter,
  HttpError,
  isChallenge,
  LnreaderError,
  MAX_CHARS_CAP,
  PluginError,
  renderChapter,
  sliceContent,
} from '@lnreader-cli/core';

const base = 'https://novels.test/novel/1/ch-2';

describe('renderChapter', () => {
  const html = `<h3>Chapter 2: Rain</h3>
    <p>She said <b>no</b>, twice.</p><p>&nbsp;</p>
    <p><img src="/img/map.png" alt="The map"></p>
    <script>steal()</script><iframe src="x"></iframe>
    <p>Line one<br>line two</p>
    <p><a href="/next">Next</a></p>`;

  it('makes Markdown with the chapter name as the first heading', async () => {
    const md = await renderChapter(html, {
      title: 'Chapter 2: Rain',
      baseUrl: base,
      format: 'md',
    });
    expect(md).toBe(
      [
        '# Chapter 2: Rain',
        '',
        'She said **no**, twice.',
        '',
        '![The map](https://novels.test/img/map.png)',
        '',
        'Line one',
        'line two',
        '',
        '[Next](https://novels.test/next)',
      ].join('\n'),
    );
  });

  it('adds the heading when the chapter has none', async () => {
    const md = await renderChapter('<p>Just text.</p>', {
      title: 'Prologue',
      baseUrl: base,
      format: 'md',
    });
    expect(md).toBe('# Prologue\n\nJust text.');
  });

  it('is deterministic', async () => {
    const opts = { title: 'Chapter 2: Rain', baseUrl: base } as const;
    for (const format of ['md', 'text', 'numbered'] as const) {
      const a = await renderChapter(html, { ...opts, format });
      const b = await renderChapter(html, { ...opts, format });
      expect(a).toBe(b);
    }
  });

  it('makes plain text without Markdown syntax or escapes', async () => {
    const text = await renderChapter(
      '<p>Use *stars* and _bars_ and <i>italics</i>.</p><img src="/a.png">',
      { title: 'One', baseUrl: base, format: 'text' },
    );
    expect(text).toBe('One\n\nUse *stars* and _bars_ and italics.\n\n[image]');
  });

  it('numbers paragraphs for citing', async () => {
    const numbered = await renderChapter(html, {
      title: 'Chapter 2: Rain',
      baseUrl: base,
      format: 'numbered',
    });
    expect(numbered).toBe(
      [
        '# Chapter 2: Rain',
        '',
        '[1] She said no, twice.',
        '[2] [image: The map]',
        '[3] Line one line two',
        '[4] Next',
      ].join('\n'),
    );
  });

  it('turns plain text with line breaks into paragraphs', async () => {
    const md = await renderChapter('First line\nSecond line', {
      title: 'T',
      baseUrl: base,
      format: 'md',
    });
    expect(md).toBe('# T\n\nFirst line\n\nSecond line');
  });
});

describe('sliceContent', () => {
  const text = Array.from({ length: 20 }, (_, i) => `Paragraph ${i}.`).join(
    '\n\n',
  );

  it('returns everything without a limit', () => {
    expect(sliceContent(text)).toEqual({
      text,
      offset: 0,
      totalChars: text.length,
    });
  });

  it('cuts on paragraph breaks and resumes where it stopped', () => {
    const parts: string[] = [];
    let offset: number | undefined = 0;
    while (offset !== undefined) {
      const s = sliceContent(text, offset, 50);
      expect(s.text.length).toBeLessThanOrEqual(50);
      expect(s.text).toMatch(/\.$/);
      parts.push(s.text);
      offset = s.nextOffset;
    }
    expect(parts.join('\n\n')).toBe(text);
  });

  it('never splits a surrogate pair', () => {
    const s = sliceContent('😀😀😀', 0, 3);
    expect(s.text).toBe('😀');
    expect(s.nextOffset).toBe(2);
  });

  it('caps the chunk size', () => {
    const big = 'x'.repeat(MAX_CHARS_CAP + 10);
    expect(sliceContent(big, 0, MAX_CHARS_CAP * 2).text).toHaveLength(
      MAX_CHARS_CAP,
    );
  });

  it('rejects an offset past the end', () => {
    expect(() => sliceContent('abc', 4)).toThrow(LnreaderError);
  });
});

describe('findChapter', () => {
  const chapters = [
    { name: 'Prologue', path: 'n/0' },
    { name: 'Chapter 1 - Start', path: 'n/1' },
    { name: 'Ch. 2', path: '/n/2' },
    { name: 'Extra', path: 'n/x', chapterNumber: 7 },
  ];

  it('finds by index, chapter number, path and URL', () => {
    expect(findChapter(chapters, 1).chapter.name).toBe('Prologue');
    expect(findChapter(chapters, '2').index).toBe(2);
    expect(findChapter(chapters, 'ch:2').index).toBe(3);
    expect(findChapter(chapters, 'ch1').index).toBe(2);
    expect(findChapter(chapters, 'ch:7').index).toBe(4);
    expect(findChapter(chapters, 'n/2').index).toBe(3);
    expect(findChapter(chapters, 'path:n/x').index).toBe(4);
    expect(
      findChapter(
        chapters,
        'https://novels.test/n/1',
        p => new URL(p.replace(/^\//, ''), 'https://novels.test/').href,
      ).index,
    ).toBe(2);
  });

  it('fails with CHAPTER_NOT_FOUND', () => {
    for (const ref of [0, 5, 'ch:99', 'nope']) {
      expect(() => findChapter(chapters, ref)).toThrow(
        expect.objectContaining({ code: 'CHAPTER_NOT_FOUND' }),
      );
    }
  });
});

describe('FetchBudget', () => {
  it('counts per host and refuses past the limit', async () => {
    const budget = new FetchBudget({ limit: 2 });
    await budget.ensure('a.test', 2);
    budget.take('a.test');
    budget.take('a.test');
    await expect(budget.ensure('a.test')).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    await budget.ensure('b.test', 2);
    expect(budget.usage('a.test')).toEqual({ used: 2, limit: 2, remaining: 0 });
  });

  it('picks up a limit raised since the session started', async () => {
    let configured = 1;
    const budget = new FetchBudget({
      limit: 1,
      refreshLimit: async () => configured,
    });
    budget.take('a.test');
    await expect(budget.ensure('a.test')).rejects.toThrow(/used up/);
    configured = 5;
    await budget.ensure('a.test', 4);
  });
});

describe('isChallenge', () => {
  const res = (status: number, headers: Record<string, string>, body = '') =>
    new Response(body, { status, headers });

  it('spots Cloudflare challenges', async () => {
    expect(await isChallenge(res(403, { 'cf-mitigated': 'challenge' }))).toBe(
      true,
    );
    expect(
      await isChallenge(
        res(
          503,
          { server: 'cloudflare', 'content-type': 'text/html' },
          '<title>Just a moment...</title>',
        ),
      ),
    ).toBe(true);
  });

  it('leaves ordinary errors alone', async () => {
    expect(await isChallenge(res(403, { server: 'nginx' }))).toBe(false);
    expect(
      await isChallenge(
        res(
          403,
          { server: 'cloudflare', 'content-type': 'text/html' },
          '<title>Forbidden</title>',
        ),
      ),
    ).toBe(false);
    expect(await isChallenge(res(200, { server: 'cloudflare' }))).toBe(false);
  });
});

describe('errorInfo', () => {
  it('finds a challenge inside a plugin error and names the plugin', () => {
    const err = new PluginError(
      'novelfire',
      'parseChapter',
      new ChallengeError('novelfire.net', 'https://novelfire.net/x'),
    );
    expect(errorInfo(err)).toEqual({
      code: 'NEEDS_AUTH',
      message: expect.stringContaining('browser check'),
      hint: expect.stringContaining('lnreader auth novelfire'),
    });
  });

  it('maps other errors', () => {
    expect(errorInfo(new HttpError(500, 'https://x.test')).code).toBe(
      'NETWORK',
    );
    expect(errorInfo(new PluginError('p', 'm', new Error('boom'))).code).toBe(
      'PLUGIN_ERROR',
    );
    expect(errorInfo(new Error('?'))).toEqual({
      code: 'INTERNAL',
      message: '?',
    });
  });
});
