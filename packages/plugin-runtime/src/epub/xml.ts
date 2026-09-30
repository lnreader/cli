export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Strip characters that are illegal in XML 1.0. */
export function stripInvalidXmlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

export function xhtmlPage(opts: {
  title: string;
  lang: string;
  body: string;
  css?: string[];
  epubType?: string;
}): string {
  const links = (opts.css ?? [])
    .map(
      href =>
        `    <link rel="stylesheet" type="text/css" href="${escapeXml(href)}"/>`,
    )
    .join('\n');
  const bodyType = opts.epubType ? ` epub:type="${opts.epubType}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${opts.lang}" lang="${opts.lang}">
  <head>
    <meta charset="UTF-8"/>
    <title>${escapeXml(opts.title)}</title>
${links}
  </head>
  <body${bodyType}>
${opts.body}
  </body>
</html>
`;
}
