export function withoutHugoFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/);
  return match ? source.slice(match[0].length) : source;
}

export function titleFromFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/);
  if (!match) return '';

  const title = match[2].match(/^\s*title\s*(?::|=)\s*(.+?)\s*$/mi);
  if (!title) return '';
  return title[1].replace(/\s+#.*$/, '').replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim();
}

export function expandHugoRefLinks(markdown) {
  return markdown.replace(
    /\[([^\]]+)\]\(\s*\{\{<\s*ref\s+["']([^"']+)["']\s*>\}\}\s*\)/gi,
    (fullMatch, label, target) => `[${label}](hugo-ref:${target})`
  );
}
