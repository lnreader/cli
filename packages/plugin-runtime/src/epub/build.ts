import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { sniffImage } from './images.js';
import { buildNav, buildNcx, type TocEntry } from './nav.js';
import { buildOpf, type EpubMetadata, type ManifestItem } from './opf.js';
import { escapeXml, xhtmlPage } from './xml.js';

export type BookChapter = {
  title: string;
  /** Sanitized XHTML body fragment; image hrefs relative to `text/`. */
  body: string;
};

export type BookImage = { data: Uint8Array; mediaType: string; ext: string };

export type TitlePage = {
  title: string;
  author?: string;
  summary?: string;
  details: Array<[label: string, value: string]>;
};

/**
 * Collects images for one book, deduplicated by content, and hands back the
 * href a chapter should use.
 */
export class ImageCollector {
  readonly items: Array<BookImage & { id: string; path: string }> = [];
  private readonly byHash = new Map<string, string>();

  /** Returns the href relative to `text/`, or undefined for unsupported data. */
  add(data: Uint8Array): string | undefined {
    const type = sniffImage(data);
    if (!type) return undefined;
    const hash = createHash('sha1').update(data).digest('hex');
    let path = this.byHash.get(hash);
    if (!path) {
      const n = String(this.items.length + 1).padStart(4, '0');
      path = `images/img${n}.${type.ext}`;
      this.items.push({ id: `img${n}`, path, data, ...type });
      this.byHash.set(hash, path);
    }
    return `../${path}`;
  }
}

export type BookInput = {
  metadata: EpubMetadata;
  css: string;
  cover: Uint8Array;
  titlePage: TitlePage;
  chapters: BookChapter[];
  images: ImageCollector;
};

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function titlePageBody(t: TitlePage): string {
  const rows = t.details
    .map(([k, v]) => {
      const value = /^https?:\/\//.test(v)
        ? `<a href="${escapeXml(v)}">${escapeXml(v)}</a>`
        : escapeXml(v);
      return `      <p class="meta"><strong>${escapeXml(k)}:</strong> ${value}</p>`;
    })
    .join('\n');
  const summary = (t.summary ?? '')
    .split(/\n+/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => `      <p>${escapeXml(l)}</p>`)
    .join('\n');
  return `    <section class="title-page" epub:type="titlepage">
      <h1>${escapeXml(t.title)}</h1>
${t.author ? `      <p class="author">${escapeXml(t.author)}</p>\n` : ''}${rows}
${summary ? `      <div class="summary">\n${summary}\n      </div>` : ''}
    </section>`;
}

/** Assemble an EPUB 3 (with EPUB 2 NCX) and return the zip bytes. */
export async function buildEpub(book: BookInput): Promise<Uint8Array> {
  const { metadata: meta } = book;
  const zip = new JSZip();
  // `mimetype` must be first and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);

  const css = ['../styles/main.css'];
  const manifest: ManifestItem[] = [
    { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
    {
      id: 'nav',
      href: 'nav.xhtml',
      mediaType: 'application/xhtml+xml',
      properties: 'nav',
    },
    { id: 'css', href: 'styles/main.css', mediaType: 'text/css' },
  ];
  const spine: string[] = [];
  const toc: TocEntry[] = [];
  const oebps = zip.folder('OEBPS')!;
  oebps.file('styles/main.css', book.css);

  const coverType = sniffImage(book.cover);
  if (coverType) {
    const coverPath = `images/cover.${coverType.ext}`;
    oebps.file(coverPath, book.cover);
    manifest.push({
      id: 'cover-image',
      href: coverPath,
      mediaType: coverType.mediaType,
      properties: 'cover-image',
    });
    oebps.file(
      'text/cover.xhtml',
      xhtmlPage({
        title: meta.title,
        lang: meta.lang,
        css,
        epubType: 'cover',
        body: `    <div class="cover"><img src="../${coverPath}" alt="${escapeXml(meta.title)}"/></div>`,
      }),
    );
    manifest.push({
      id: 'cover',
      href: 'text/cover.xhtml',
      mediaType: 'application/xhtml+xml',
    });
    spine.push('cover');
  }

  oebps.file(
    'text/title.xhtml',
    xhtmlPage({
      title: meta.title,
      lang: meta.lang,
      css,
      body: titlePageBody(book.titlePage),
    }),
  );
  manifest.push({
    id: 'titlepage',
    href: 'text/title.xhtml',
    mediaType: 'application/xhtml+xml',
  });
  spine.push('titlepage');
  toc.push({ title: meta.title, href: 'text/title.xhtml' });

  book.chapters.forEach((ch, i) => {
    const id = `ch${String(i + 1).padStart(4, '0')}`;
    const href = `text/${id}.xhtml`;
    oebps.file(
      href,
      xhtmlPage({ title: ch.title, lang: meta.lang, css, body: ch.body }),
    );
    manifest.push({ id, href, mediaType: 'application/xhtml+xml' });
    spine.push(id);
    toc.push({ title: ch.title, href });
  });

  for (const img of book.images.items) {
    oebps.file(img.path, img.data);
    manifest.push({ id: img.id, href: img.path, mediaType: img.mediaType });
  }

  oebps.file(
    'nav.xhtml',
    buildNav(meta.title, meta.lang, toc, ['styles/main.css']),
  );
  oebps.file('toc.ncx', buildNcx(meta.identifier, meta.title, toc));
  oebps.file('content.opf', buildOpf(meta, manifest, spine));

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/epub+zip',
  });
}

/** Stable `urn:uuid` derived from a name, so rebuilds keep the same identifier. */
export function stableUuid(name: string): string {
  const h = createHash('sha1').update(name).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
