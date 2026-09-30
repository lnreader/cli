import { escapeXml } from './xml.js';

export type ImageType = { mediaType: string; ext: string };

/** Sniff the image type from magic bytes; EPUB 3 core media types only. */
export function sniffImage(data: Uint8Array): ImageType | undefined {
  const b = data;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mediaType: 'image/jpeg', ext: 'jpg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mediaType: 'image/png', ext: 'png' };
  }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46)
    return { mediaType: 'image/gif', ext: 'gif' };
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return { mediaType: 'image/webp', ext: 'webp' };
  }
  const head = new TextDecoder().decode(b.slice(0, 512)).trimStart();
  if (
    /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/i.test(
      head,
    )
  ) {
    return { mediaType: 'image/svg+xml', ext: 'svg' };
  }
  return undefined;
}

function wrap(text: string, max: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1]!.replace(/.{0,1}$/, '…');
  }
  return lines;
}

/** A plain typographic cover for novels without one. */
export function generateCover(
  title: string,
  author?: string,
  subtitle?: string,
): Uint8Array {
  const titleLines = wrap(title, 18, 6);
  const titleY = 520 - (titleLines.length * 90) / 2;
  const tspans = titleLines
    .map(
      (l, i) => `<tspan x="600" y="${titleY + i * 90}">${escapeXml(l)}</tspan>`,
    )
    .join('');
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
  <rect width="1200" height="1800" fill="#1f2a36"/>
  <rect x="60" y="60" width="1080" height="1680" fill="none" stroke="#c9a96e" stroke-width="6"/>
  <text font-family="Georgia, serif" font-size="80" fill="#f4efe6" text-anchor="middle">${tspans}</text>
  ${subtitle ? `<text x="600" y="${titleY + titleLines.length * 90 + 60}" font-family="Georgia, serif" font-size="50" fill="#c9a96e" text-anchor="middle">${escapeXml(subtitle)}</text>` : ''}
  ${author ? `<text x="600" y="1560" font-family="Georgia, serif" font-size="56" fill="#c9a96e" text-anchor="middle">${escapeXml(author)}</text>` : ''}
</svg>
`;
  return new TextEncoder().encode(svg);
}
