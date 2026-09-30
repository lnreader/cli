import TurndownService from 'turndown';
import { LnreaderError } from '../errors.js';
import { sanitizeChapter } from '../epub/sanitize.js';

export type ReadFormat = 'md' | 'text' | 'numbered' | 'html';
export const READ_FORMATS: readonly ReadFormat[] = [
  'md',
  'text',
  'numbered',
  'html',
];

/** Largest chunk any caller may ask for, in characters. */
export const MAX_CHARS_CAP = 100_000;
/** Chunk size for agents that don't say. */
export const DEFAULT_MAX_CHARS = 20_000;

const markdown = new TurndownService({
  headingStyle: 'atx',
  hr: '* * *',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
  strongDelimiter: '**',
  linkStyle: 'inlined',
});

/** Same structure as Markdown, minus the syntax: no escapes, emphasis or links. */
const plain = new TurndownService({
  headingStyle: 'atx',
  hr: '* * *',
  bulletListMarker: '-',
  codeBlockStyle: 'indented',
});
plain.escape = (s: string) => s;
plain.addRule('heading', {
  filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
  replacement: content => `\n\n${content.trim()}\n\n`,
});
plain.addRule('inline', {
  filter: ['em', 'i', 'strong', 'b', 'code', 'a', 'del', 's', 'u', 'mark'],
  replacement: content => content,
});
plain.addRule('image', {
  filter: 'img',
  replacement: (_content, node) => {
    const alt = (node as { getAttribute(name: string): string | null })
      .getAttribute('alt')
      ?.trim();
    return alt ? `[image: ${alt}]` : '[image]';
  },
});

const tidy = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const norm = (s: string) =>
  s
    .replace(/[#*_\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Drop a leading heading that repeats the chapter title. */
function dropTitleHeading(body: string, title: string): string {
  const m = body.match(/^(?:#{1,6} +)?([^\n]+)\n*/);
  if (m && norm(m[1]!) === norm(title)) return body.slice(m[0].length);
  return body;
}

/**
 * Render chapter HTML for reading. It runs through the same sanitizer as
 * EPUB output; images stay as links to their URLs. The chapter name is
 * always the first heading, and the same input always gives the same text.
 */
export async function renderChapter(
  html: string,
  opts: { title: string; baseUrl: string; format: ReadFormat },
): Promise<string> {
  const title = opts.title.trim() || 'Untitled chapter';
  if (opts.format === 'html') {
    const { body } = await sanitizeChapter(html, {
      baseUrl: opts.baseUrl,
      title,
    });
    return body;
  }
  // No title here: we add our own heading so every format starts the same way.
  const { body } = await sanitizeChapter(html, {
    baseUrl: opts.baseUrl,
    title: '',
  });
  const service = opts.format === 'md' ? markdown : plain;
  const text = dropTitleHeading(tidy(service.turndown(body)), title);
  const heading = opts.format === 'md' ? `# ${markdown.escape(title)}` : title;
  if (opts.format !== 'numbered') return tidy(`${heading}\n\n${text}`);

  // `[n] paragraph`, one per line, so agents can cite exact passages.
  const paragraphs = text
    .split(/\n{2,}/)
    .map(p => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);
  return [`# ${title}`, '', ...paragraphs.map((p, i) => `[${i + 1}] ${p}`)]
    .join('\n')
    .trim();
}

export type Slice = {
  text: string;
  offset: number;
  /** Where the next chunk starts; absent when this chunk reaches the end. */
  nextOffset?: number;
  totalChars: number;
};

/**
 * Cut `maxChars` (at most `MAX_CHARS_CAP`) characters starting at `offset`, ending on a paragraph
 * break (or line, or word) when one falls in the second half of the chunk.
 */
export function sliceContent(
  content: string,
  offset = 0,
  maxChars?: number,
): Slice {
  const totalChars = content.length;
  if (!Number.isInteger(offset) || offset < 0 || offset > totalChars) {
    throw new LnreaderError(
      'INVALID_INPUT',
      `offset ${offset} is outside the chapter (0-${totalChars})`,
    );
  }
  if (maxChars !== undefined && (!Number.isInteger(maxChars) || maxChars < 1))
    throw new LnreaderError(
      'INVALID_INPUT',
      'max_chars must be a positive integer',
    );
  const limit =
    maxChars === undefined ? Infinity : Math.min(maxChars, MAX_CHARS_CAP);
  if (offset + limit >= totalChars)
    return { text: content.slice(offset), offset, totalChars };

  let end = offset + limit;
  const floor = offset + Math.floor(limit / 2);
  for (const sep of ['\n\n', '\n', ' ']) {
    const at = content.lastIndexOf(sep, end - sep.length);
    if (at >= floor) {
      end = at;
      break;
    }
  }
  // Never split a surrogate pair.
  const code = content.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  let next = end;
  while (next < totalChars && /\s/.test(content[next]!)) next++;
  return {
    text: content.slice(offset, end),
    offset,
    nextOffset: next < totalChars ? next : undefined,
    totalChars,
  };
}
