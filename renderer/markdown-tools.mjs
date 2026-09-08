export function hugoContent(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/);
  return {
    content: match ? source.slice(match[0].length) : source,
    startLine: match ? (match[0].match(/\n/g)?.length || 0) + 1 : 1
  };
}

export function withoutHugoFrontMatter(text) {
  return hugoContent(text).content;
}

export function titleFromFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/);
  if (!match) return '';

  const title = match[2].match(/^\s*title\s*(?::|=)\s*(.+?)\s*$/mi);
  if (!title) return '';
  const value = title[1].trim();
  if (value.startsWith('"')) {
    const quoted = value.match(/^"((?:\\.|[^"\\])*)"/);
    if (quoted) {
      try { return JSON.parse(`"${quoted[1]}"`); }
      catch { return quoted[1]; }
    }
  }
  if (value.startsWith("'")) {
    const quoted = value.match(/^'((?:''|[^'])*)'/);
    if (quoted) return match[1] === '---' ? quoted[1].replace(/''/g, "'") : quoted[1];
  }
  return value.replace(/\s+#.*$/, '').trim();
}

export function draftFromFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/);
  if (!match) return false;

  const draft = match[2].match(/^\s*draft\s*(?::|=)\s*(true|false)\s*(?:#.*)?$/mi);
  return draft?.[1].toLowerCase() === 'true';
}

export function featuredImageFromFrontMatter(text) {
  const source = text || '';
  const frontMatter = source.match(/^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/);
  if (!frontMatter) return '';

  const field = frontMatter[2].match(/^\s*featured_image\s*(?::|=)\s*(.*?)\s*$/mi);
  if (!field) return '';
  const value = field[1].trim();
  if (value.startsWith('"')) {
    const quoted = value.match(/^"((?:\\.|[^"\\])*)"/);
    if (quoted) {
      try { return JSON.parse(`"${quoted[1]}"`); }
      catch { return quoted[1]; }
    }
  }
  if (value.startsWith("'")) {
    const quoted = value.match(/^'((?:''|[^'])*)'/);
    if (quoted) return frontMatter[1] === '---' ? quoted[1].replace(/''/g, "'") : quoted[1];
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function shortcodeAttributes(source) {
  const attributes = {};
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '')
      .replace(/&(amp|quot|lt|gt);/g, (_, entity) => ({ amp: '&', quot: '"', lt: '<', gt: '>' })[entity]);
  }
  return attributes;
}

export function imagesFromMarkdown(text) {
  const { content } = hugoContent(text);
  const matches = [];

  let match;
  const lightboxes = /\{\{<\s*lightbox\b([^\n]*?)>\}\}/gi;
  while ((match = lightboxes.exec(content))) {
    const attributes = shortcodeAttributes(match[1]);
    if (attributes.src) {
      matches.push({ index: match.index, src: attributes.src, previewSrc: attributes.thumb || attributes.src, alt: attributes.alt || '' });
    }
  }

  const markdownImages = /!\[([^\]]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;
  while ((match = markdownImages.exec(content))) {
    matches.push({ index: match.index, src: match[2] || match[3], previewSrc: match[2] || match[3], alt: match[1] || '' });
  }

  const htmlImages = /<img\b([^>]*?)>/gi;
  while ((match = htmlImages.exec(content))) {
    const attributes = shortcodeAttributes(match[1]);
    if (attributes.src) {
      matches.push({ index: match.index, src: attributes.src, previewSrc: attributes.src, alt: attributes.alt || '' });
    }
  }

  const seen = new Set();
  return matches.sort((a, b) => a.index - b.index).flatMap(({ index, ...image }) => {
    if (seen.has(image.src)) return [];
    seen.add(image.src);
    return [image];
  });
}

function frontMatterFieldEdit(text, field, value) {
  const source = text || '';
  const frontMatter = source.match(/^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?=\r?\n|$)/);

  if (!frontMatter) {
    const newline = source.includes('\r\n') ? '\r\n' : '\n';
    return { from: 0, to: 0, insert: `+++${newline}${field} = ${value}${newline}+++${newline}${newline}` };
  }

  const delimiter = frontMatter[1];
  const bodyStart = delimiter.length + (source.startsWith(`${delimiter}\r\n`) ? 2 : 1);
  const existing = frontMatter[2].match(new RegExp(`^([ \\t]*${field}[ \\t]*(?::|=))[ \\t]*.*$`, 'mi'));
  if (existing) {
    const from = bodyStart + existing.index;
    return { from, to: from + existing[0].length, insert: `${existing[1]} ${value}` };
  }

  const closingStart = frontMatter[0].lastIndexOf(delimiter);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const assignment = delimiter === '+++' ? `${field} = ${value}` : `${field}: ${value}`;
  return { from: closingStart, to: closingStart, insert: `${assignment}${newline}` };
}

export function featuredImageEdit(text, imagePath) {
  if (typeof imagePath !== 'string' || !imagePath) throw new Error('Choose an image for the post.');
  return frontMatterFieldEdit(text, 'featured_image', JSON.stringify(imagePath));
}

export function draftEdit(text, draft) {
  return frontMatterFieldEdit(text, 'draft', String(Boolean(draft)));
}

export function expandHugoRefLinks(markdown) {
  return markdown.replace(
    /\[([^\]]+)\]\(\s*\{\{<\s*ref\s+["']([^"']+)["']\s*>\}\}\s*\)/gi,
    (fullMatch, label, target) => `[${label}](hugo-ref:${target})`
  );
}
