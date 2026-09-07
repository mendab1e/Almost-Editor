function normalizedRange(source, from, to) {
  const length = source.length;
  const start = Math.max(0, Math.min(Number(from) || 0, length));
  const end = Math.max(start, Math.min(Number(to) || 0, length));
  return { from: start, to: end };
}

function replacement(from, to, insert, selectionStart, selectionEnd = selectionStart) {
  return { from, to, insert, selectionStart, selectionEnd };
}

export function wrapMarkdownSelection(source, from, to, prefix, suffix = prefix, placeholder = 'text') {
  const range = normalizedRange(source, from, to);
  const selected = source.slice(range.from, range.to);
  const content = selected || placeholder;
  return replacement(
    range.from,
    range.to,
    `${prefix}${content}${suffix}`,
    range.from + prefix.length,
    range.from + prefix.length + content.length
  );
}

function selectedLineRange(source, from, to) {
  const range = normalizedRange(source, from, to);
  const lineFrom = range.from === 0 ? 0 : source.lastIndexOf('\n', range.from - 1) + 1;
  const inclusiveEnd = range.to > range.from && source[range.to - 1] === '\n' ? range.to - 1 : range.to;
  const nextBreak = source.indexOf('\n', inclusiveEnd);
  const lineTo = nextBreak === -1 ? source.length : nextBreak;
  return { from: lineFrom, to: lineTo };
}

function stripBlockPrefix(line) {
  return line
    .replace(/^ {0,3}#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*(?:[-+*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '');
}

export function formatMarkdownBlock(source, from, to, style) {
  const range = selectedLineRange(source, from, to);
  const original = source.slice(range.from, range.to) || '';
  const sourceLines = (original || 'Text').split('\n');
  const prefixes = {
    paragraph: () => '',
    h1: () => '# ',
    h2: () => '## ',
    h3: () => '### ',
    blockquote: () => '> ',
    unordered: () => '- ',
    ordered: (index) => `${index + 1}. `,
    task: () => '- [ ] '
  };
  const prefixFor = prefixes[style];
  if (!prefixFor) throw new Error(`Unsupported Markdown block style: ${style}`);

  const lines = sourceLines.map((line, index) => `${prefixFor(index)}${stripBlockPrefix(line)}`);
  const insert = lines.join('\n');
  return replacement(range.from, range.to, insert, range.from, range.from + insert.length);
}

export function insertMarkdownBlock(source, from, to, block, placeholder = '') {
  const range = normalizedRange(source, from, to);
  const selected = source.slice(range.from, range.to);
  const content = selected || placeholder;
  const before = range.from > 0 && source[range.from - 1] !== '\n' ? '\n\n' : '';
  const after = range.to < source.length && source[range.to] !== '\n' ? '\n\n' : '\n';
  const insert = `${before}${block(content)}${after}`;
  const contentOffset = insert.indexOf(content);
  const selectionStart = content ? range.from + contentOffset : range.from + insert.length;
  return replacement(range.from, range.to, insert, selectionStart, selectionStart + content.length);
}

export function buildMarkdownLink(label, target) {
  const text = String(label || '').trim();
  if (!text) throw new Error('Link text is required.');
  const escapedLabel = text.replace(/([\\[\]])/g, '\\$1');

  if (target.type === 'post') {
    const postPath = String(target.value || '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/?(?:content\/)?posts\//, '')
      .replace(/^\/+|\/+$/g, '');
    if (!postPath) throw new Error('Choose a blog article.');
    return `[${escapedLabel}]({{< ref "/posts/${postPath}" >}})`;
  }

  const url = String(target.value || '').trim();
  if (!url) throw new Error('Enter a URL.');
  return `[${escapedLabel}](${url})`;
}
