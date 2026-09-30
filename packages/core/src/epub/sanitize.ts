import * as cheerio from 'cheerio';
import render from 'dom-serializer';
import sanitizeHtml from 'sanitize-html';
import { escapeXml, stripInvalidXmlChars } from './xml.js';

const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'div',
  'span',
  'section',
  'article',
  'blockquote',
  'pre',
  'code',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'del',
  'ins',
  'sub',
  'sup',
  'small',
  'mark',
  'q',
  'cite',
  'abbr',
  'ruby',
  'rt',
  'rp',
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'th',
  'td',
  'caption',
  'colgroup',
  'col',
  'figure',
  'figcaption',
  'img',
  'a',
];

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'blockquote',
  'pre',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'dl',
  'table',
  'figure',
  'hr',
]);

export type SanitizedChapter = {
  /** XHTML body fragment. */
  body: string;
  /** Absolute image URLs referenced by `<img>`, in document order. */
  images: string[];
};

export type SanitizeOptions = {
  /** Chapter URL used to resolve relative links and images. */
  baseUrl: string;
  /** Chapter title, prepended as a heading when the body has none. */
  title: string;
  /** Drop all images. */
  noImages?: boolean;
  /**
   * Download an image and return its href inside the book, or undefined to
   * drop it. Without this, images keep their absolute URLs.
   */
  resolveImage?: (url: string) => Promise<string | undefined>;
};

function absolutize(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return undefined;
  try {
    return new URL(trimmed, base).href;
  } catch {
    return undefined;
  }
}

/** Reduce arbitrary chapter HTML to a safe, well-formed XHTML fragment. */
export async function sanitizeChapter(
  html: string,
  opts: SanitizeOptions,
): Promise<SanitizedChapter> {
  const clean = sanitizeHtml(stripInvalidXmlChars(html), {
    allowedTags: opts.noImages
      ? ALLOWED_TAGS.filter(t => t !== 'img')
      : ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'title'],
      img: [
        'src',
        'alt',
        'title',
        'width',
        'height',
        'data-src',
        'data-lazy-src',
        'data-original',
      ],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      ol: ['start'],
      '*': ['id', 'lang', 'dir'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    allowProtocolRelative: true,
    nonTextTags: [
      'script',
      'style',
      'textarea',
      'noscript',
      'template',
      'iframe',
      'svg',
      'button',
      'select',
      'form',
    ],
  });

  const $ = cheerio.load(clean, { xml: false }, false);
  const images: string[] = [];
  const ids = new Set<string>();

  $('[id]').each((_, el) => {
    const id = $(el).attr('id')!;
    if (!/^[A-Za-z_][\w.-]*$/.test(id) || ids.has(id)) $(el).removeAttr('id');
    else ids.add(id);
  });

  $('a').each((_, el) => {
    const href = absolutize($(el).attr('href'), opts.baseUrl);
    if (href) $(el).attr('href', href);
    else $(el).removeAttr('href');
  });

  $('img').each((_, el) => {
    const $el = $(el);
    const raw =
      $el.attr('data-src') ||
      $el.attr('data-lazy-src') ||
      $el.attr('data-original') ||
      $el.attr('src');
    const src = absolutize(raw, opts.baseUrl);
    $el
      .removeAttr('data-src')
      .removeAttr('data-lazy-src')
      .removeAttr('data-original');
    for (const dim of ['width', 'height']) {
      if (!/^\d+$/.test($el.attr(dim) ?? '')) $el.removeAttr(dim);
    }
    if (!src) {
      $el.remove();
      return;
    }
    $el.attr('src', src);
    $el.attr('alt', $el.attr('alt') ?? '');
    images.push(src);
  });

  if (opts.resolveImage) {
    const resolved = new Map<string, string | undefined>();
    for (const url of new Set(images))
      resolved.set(url, await opts.resolveImage(url));
    $('img').each((_, el) => {
      const href = resolved.get($(el).attr('src')!);
      if (href) $(el).attr('src', href);
      else $(el).remove();
    });
  }

  // Drop paragraphs that hold only whitespace.
  $('p').each((_, el) => {
    const $el = $(el);
    if (!$el.text().trim() && $el.find('img').length === 0) $el.remove();
  });

  const heading =
    $('h1, h2, h3').length === 0 && opts.title
      ? `<h2 class="chapter-title">${escapeXml(opts.title)}</h2>\n`
      : '';
  const nodes = $.root().contents().toArray();
  const hasBlocks = nodes.some(n => n.type === 'tag' && BLOCK_TAGS.has(n.name));
  if (!hasBlocks && images.length === 0 && /\n/.test($.root().text())) {
    // Plain text with line breaks: one paragraph per line.
    const lines = $.root()
      .text()
      .split(/\n+/)
      .map(l => l.trim())
      .filter(Boolean);
    return {
      body: heading + lines.map(l => `<p>${escapeXml(l)}</p>`).join('\n'),
      images,
    };
  }
  // xmlMode escapes all non-ASCII as numeric references; XML specials stay
  // named (&amp; &lt; ...), so decoding numeric ones back to UTF-8 is safe.
  const body = render(nodes, { xmlMode: true, selfClosingTags: true }).replace(
    /&#x([0-9a-f]+);/gi,
    (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
  );
  return { body: heading + (body.trim() || '<p></p>'), images };
}
