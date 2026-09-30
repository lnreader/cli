import { escapeXml, xhtmlPage } from './xml.js';

export type TocEntry = { title: string; href: string };

export function buildNav(
  title: string,
  lang: string,
  toc: TocEntry[],
  css: string[],
): string {
  const items = toc
    .map(
      t =>
        `        <li><a href="${escapeXml(t.href)}">${escapeXml(t.title)}</a></li>`,
    )
    .join('\n');
  return xhtmlPage({
    title,
    lang,
    css,
    body: `    <nav epub:type="toc" id="toc">
      <h1>Contents</h1>
      <ol>
${items}
      </ol>
    </nav>`,
  });
}

/** EPUB 2 NCX, for older reading systems. */
export function buildNcx(
  identifier: string,
  title: string,
  toc: TocEntry[],
): string {
  const points = toc
    .map(
      (t, i) => `    <navPoint id="np${i + 1}" playOrder="${i + 1}">
      <navLabel><text>${escapeXml(t.title)}</text></navLabel>
      <content src="${escapeXml(t.href)}"/>
    </navPoint>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}
