import { escapeXml } from './xml.js';

export type ManifestItem = {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
};

export type EpubMetadata = {
  identifier: string;
  title: string;
  lang: string;
  authors: string[];
  artists: string[];
  subjects: string[];
  description?: string;
  status?: string;
  source?: string;
  publisher?: string;
  /** Plugin id and version the book was built from. */
  generator?: string;
  series?: { name: string; position: number };
  modified: Date;
};

const isoSeconds = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export function buildOpf(
  meta: EpubMetadata,
  manifest: ManifestItem[],
  spine: string[],
): string {
  const m: string[] = [
    `<dc:identifier id="book-id">${escapeXml(meta.identifier)}</dc:identifier>`,
    `<dc:title id="title">${escapeXml(meta.title)}</dc:title>`,
    `<dc:language>${escapeXml(meta.lang)}</dc:language>`,
    `<meta property="dcterms:modified">${isoSeconds(meta.modified)}</meta>`,
  ];
  meta.authors.forEach((a, i) => {
    m.push(`<dc:creator id="aut${i}">${escapeXml(a)}</dc:creator>`);
    m.push(
      `<meta refines="#aut${i}" property="role" scheme="marc:relators">aut</meta>`,
    );
  });
  meta.artists.forEach((a, i) => {
    m.push(`<dc:contributor id="ill${i}">${escapeXml(a)}</dc:contributor>`);
    m.push(
      `<meta refines="#ill${i}" property="role" scheme="marc:relators">ill</meta>`,
    );
  });
  for (const s of meta.subjects)
    m.push(`<dc:subject>${escapeXml(s)}</dc:subject>`);
  if (meta.description)
    m.push(`<dc:description>${escapeXml(meta.description)}</dc:description>`);
  if (meta.publisher)
    m.push(`<dc:publisher>${escapeXml(meta.publisher)}</dc:publisher>`);
  if (meta.source) m.push(`<dc:source>${escapeXml(meta.source)}</dc:source>`);
  if (meta.status)
    m.push(`<meta property="lnreader:status">${escapeXml(meta.status)}</meta>`);
  if (meta.generator)
    m.push(
      `<meta property="lnreader:plugin">${escapeXml(meta.generator)}</meta>`,
    );
  if (meta.series) {
    m.push(
      `<meta property="belongs-to-collection" id="series">${escapeXml(meta.series.name)}</meta>`,
    );
    m.push(`<meta refines="#series" property="collection-type">series</meta>`);
    m.push(
      `<meta refines="#series" property="group-position">${meta.series.position}</meta>`,
    );
    // Calibre reads its own series metadata.
    m.push(
      `<meta name="calibre:series" content="${escapeXml(meta.series.name)}"/>`,
    );
    m.push(
      `<meta name="calibre:series_index" content="${meta.series.position}"/>`,
    );
  }
  const cover = manifest.find(i =>
    i.properties?.split(' ').includes('cover-image'),
  );
  if (cover) m.push(`<meta name="cover" content="${cover.id}"/>`);

  const items = manifest
    .map(
      i =>
        `    <item id="${i.id}" href="${escapeXml(i.href)}" media-type="${i.mediaType}"${
          i.properties ? ` properties="${i.properties}"` : ''
        }/>`,
    )
    .join('\n');
  const refs = spine.map(id => `    <itemref idref="${id}"/>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${meta.lang}" prefix="lnreader: https://github.com/lnreader/cli#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
${m.map(l => `    ${l}`).join('\n')}
  </metadata>
  <manifest>
${items}
  </manifest>
  <spine toc="ncx">
${refs}
  </spine>
</package>
`;
}
