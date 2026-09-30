import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { downloadNovel, type DownloadOptions } from '../src/download.js';
import { ChapterCache } from '../src/store/cache.js';
import { resolvePaths } from '../src/store/paths.js';
import { fixtureRunner, novelSite, tempHome } from './helpers.js';

async function setup(chapters = 5) {
  const home = await tempHome();
  const site = novelSite(chapters);
  const { runner, http, jar } = await fixtureRunner(site.fetch, home);
  const out = join(home, 'out');
  const base: DownloadOptions = {
    runner,
    novelPath: 'novel/abc',
    cache: new ChapterCache(resolvePaths(home)),
    http,
    jar,
    out,
    retries: 1,
    sleep: async () => {},
  };
  return { home, site, out, base };
}

const unzip = async (file: string) => JSZip.loadAsync(await readFile(file));

describe('downloadNovel', () => {
  it('writes a complete EPUB', async () => {
    const { base, out } = await setup();
    const result = await downloadNovel(base);
    expect(result.failed).toEqual([]);
    expect(result.files).toEqual([join(out, 'The Test Novel.epub')]);

    const zip = await unzip(result.files[0]!);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe(
      'application/epub+zip',
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'META-INF/container.xml',
        'OEBPS/content.opf',
        'OEBPS/nav.xhtml',
        'OEBPS/toc.ncx',
        'OEBPS/images/cover.png',
        'OEBPS/images/img0001.png',
        'OEBPS/text/ch0005.xhtml',
      ]),
    );

    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('<dc:title id="title">The Test Novel</dc:title>');
    expect(opf).toContain('<dc:creator id="aut0">Jane Writer</dc:creator>');
    expect(opf).toContain('<dc:subject>Fantasy</dc:subject>');
    expect(opf).toContain(
      '<dc:source>https://novels.test/novel/abc</dc:source>',
    );
    expect(opf).toContain(
      '<meta property="lnreader:plugin">fixture@1.0.0</meta>',
    );
    expect(opf).toContain('properties="cover-image"');

    const ch2 = await zip.file('OEBPS/text/ch0002.xhtml')!.async('string');
    expect(ch2).toContain('<h2 class="chapter-title">Chapter 2</h2>');
    expect(ch2).toContain(
      '<img src="../images/img0001.png" width="10" alt=""/>',
    );
    expect(ch2).not.toContain('broken.png');
    expect(ch2).not.toContain('<script');
    expect(ch2).toContain('ünïcödé 日本語');
  });

  it('resumes from the cache and rebuilds offline', async () => {
    const { base, site, home } = await setup();
    await downloadNovel(base);
    const chapterCalls = () =>
      site.calls.filter(c => /\/novel\/abc\/\d/.test(c.url)).length;
    expect(chapterCalls()).toBe(5);

    // A second online run only refreshes metadata.
    await downloadNovel(base);
    expect(chapterCalls()).toBe(5);

    // Offline: no network at all, same output.
    const before = site.calls.length;
    const offline = await downloadNovel({
      ...base,
      offline: true,
      out: join(home, 'offline'),
    });
    expect(site.calls.length).toBe(before);
    expect(offline.failed).toEqual([]);
    const opf = await (
      await unzip(offline.files[0]!)
    )
      .file('OEBPS/content.opf')!
      .async('string');
    expect(opf).toContain('The Test Novel');
  });

  it('retries, then skips and reports failed chapters', async () => {
    const { base, site } = await setup();
    const original = site.fetch;
    let attempts = 0;
    const flaky: typeof original = async (url, init) => {
      if (url.endsWith('/novel/abc/3')) {
        attempts++;
        return new Response('<div id="content"></div>');
      }
      return original(url, init);
    };
    const { runner, http, jar } = await fixtureRunner(flaky, await tempHome());
    const events: string[] = [];
    const result = await downloadNovel({
      ...base,
      runner,
      http,
      jar,
      onEvent: e => events.push(e.type),
    });
    expect(attempts).toBe(2);
    expect(result.failed).toEqual([
      expect.objectContaining({
        index: 3,
        error: expect.stringContaining('empty chapter'),
      }),
    ]);
    expect(result.chapters).toBe(4);
    expect(events).toContain('chapter-failed');
  });

  it('splits into numbered volumes with series metadata', async () => {
    const { base, out } = await setup(5);
    const result = await downloadNovel({
      ...base,
      split: 2,
      from: 2,
      noImages: true,
    });
    expect((await readdir(out)).sort()).toEqual([
      'The Test Novel - Vol 01 (Ch 2-2).epub',
      'The Test Novel - Vol 02 (Ch 3-4).epub',
      'The Test Novel - Vol 03 (Ch 5-5).epub',
    ]);
    const opf = await (
      await unzip(result.files[1]!)
    )
      .file('OEBPS/content.opf')!
      .async('string');
    expect(opf).toContain(
      '<meta property="belongs-to-collection" id="series">The Test Novel</meta>',
    );
    expect(opf).toContain(
      '<meta refines="#series" property="group-position">2</meta>',
    );
    expect(opf).not.toContain('img0001');
  });

  it('keeps a stable identifier across rebuilds', async () => {
    const { base, home } = await setup();
    const a = await downloadNovel(base);
    const b = await downloadNovel({ ...base, out: join(home, 'again') });
    const id = async (f: string) =>
      (await (await unzip(f)).file('OEBPS/content.opf')!.async('string')).match(
        /urn:uuid:[\w-]+/,
      )![0];
    expect(await id(a.files[0]!)).toBe(await id(b.files[0]!));
  });

  // Set EPUBCHECK_JAR to validate output with the W3C checker (needs Java).
  it.skipIf(!process.env.EPUBCHECK_JAR)(
    'passes epubcheck',
    async () => {
      const { base } = await setup();
      const single = await downloadNovel(base);
      const split = await downloadNovel({
        ...base,
        split: 3,
        out: join(base.out, 'split'),
      });
      // Generated SVG cover when the source cover is missing.
      const noCover = novelSite();
      const { runner, http, jar } = await fixtureRunner(
        (url, init) =>
          url.endsWith('cover.png')
            ? Promise.resolve(new Response('', { status: 404 }))
            : noCover.fetch(url, init),
        await tempHome(),
      );
      const generated = await downloadNovel({
        ...base,
        runner,
        http,
        jar,
        cache: new ChapterCache(resolvePaths(await tempHome())),
        out: join(base.out, 'generated'),
      });
      const cover = await (
        await unzip(generated.files[0]!)
      ).file('OEBPS/images/cover.svg');
      expect(cover).not.toBeNull();
      for (const file of [
        ...single.files,
        ...split.files,
        ...generated.files,
      ]) {
        const run = () =>
          execFileSync(
            'java',
            ['-jar', process.env.EPUBCHECK_JAR!, '--json', '-', file],
            {
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            },
          );
        let report: string;
        try {
          report = run();
        } catch (e) {
          report = (e as { stdout: string }).stdout;
        }
        const json = report.slice(
          report.indexOf('{'),
          report.lastIndexOf('}') + 1,
        );
        const messages = (
          JSON.parse(json).messages as Array<{
            severity: string;
            message: string;
          }>
        )
          .filter(
            m =>
              m.severity === 'ERROR' ||
              m.severity === 'FATAL' ||
              m.severity === 'WARNING',
          )
          .map(m => `${m.severity}: ${m.message}`);
        expect(messages, file).toEqual([]);
      }
    },
    60_000,
  );
});
