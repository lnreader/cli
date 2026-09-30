import { describe, expect, it } from 'vitest';
import { sanitizeChapter } from '../src/epub/sanitize.js';

const opts = { baseUrl: 'https://site.test/novel/1/', title: 'Chapter 1' };

describe('sanitizeChapter', () => {
  it('produces XHTML and strips scripts and handlers', async () => {
    const { body } = await sanitizeChapter(
      '<p onclick="x()">Hello<br>world &amp; <b>friends</b>&nbsp;ü</p><script>alert(1)</script><iframe src="x"></iframe>',
      opts,
    );
    expect(body).toContain('<p>Hello<br/>world &amp; <b>friends</b> ü</p>');
    expect(body).not.toMatch(/script|onclick|iframe/);
  });

  it('prepends the chapter title only when there is no heading', async () => {
    expect((await sanitizeChapter('<p>x</p>', opts)).body).toMatch(
      /^<h2 class="chapter-title">Chapter 1<\/h2>/,
    );
    expect(
      (await sanitizeChapter('<h3>Own</h3><p>x</p>', opts)).body,
    ).not.toContain('chapter-title');
  });

  it('turns plain text into paragraphs', async () => {
    const { body } = await sanitizeChapter(
      'Line one\n\nLine <two>\nLine three',
      { ...opts, title: '' },
    );
    expect(body).toBe('<p>Line one</p>\n<p>Line</p>\n<p>Line three</p>');
  });

  it('resolves lazy images and links against the chapter URL', async () => {
    const { body, images } = await sanitizeChapter(
      '<p><img data-src="../pic.png" src="placeholder.gif" width="abc"><a href="javascript:x">bad</a><a href="/next">next</a></p>',
      opts,
    );
    expect(images).toEqual(['https://site.test/novel/pic.png']);
    expect(body).toContain(
      '<img src="https://site.test/novel/pic.png" alt=""/>',
    );
    expect(body).toContain('<a>bad</a>');
    expect(body).toContain('<a href="https://site.test/next">next</a>');
  });

  it('rewrites images to local hrefs and drops ones that fail', async () => {
    const { body } = await sanitizeChapter(
      '<p><img src="/ok.png"><img src="/bad.png"></p>',
      {
        ...opts,
        resolveImage: async url =>
          url.endsWith('ok.png') ? '../images/img0001.png' : undefined,
      },
    );
    expect(body).toContain('<img src="../images/img0001.png" alt=""/>');
    expect(body).not.toContain('bad.png');
  });

  it('drops images with --no-images and removes duplicate or invalid ids', async () => {
    const { body, images } = await sanitizeChapter(
      '<p id="a">1</p><p id="a">2</p><p id="1bad">3</p><img src="x.png">',
      { ...opts, noImages: true },
    );
    expect(images).toEqual([]);
    expect(body.match(/id="a"/g)).toHaveLength(1);
    expect(body).not.toContain('1bad');
    expect(body).not.toContain('<img');
  });
});
