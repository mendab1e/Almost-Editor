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

export function expandHugoRefLinks(markdown) {
  return markdown.replace(
    /\[([^\]]+)\]\(\s*\{\{<\s*ref\s+["']([^"']+)["']\s*>\}\}\s*\)/gi,
    (fullMatch, label, target) => `[${label}](hugo-ref:${target})`
  );
}
