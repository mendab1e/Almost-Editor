import { marked } from 'marked';
import { expandHugoRefLinks, hugoContent } from './markdown-tools.mjs';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function parseShortcodeAttributes(source) {
  const attributes = {};
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1]] = (match[2] ?? match[3] ?? match[4] ?? '').replace(/&(amp|quot|lt|gt);/g, (_, entity) => ({ amp: '&', quot: '"', lt: '<', gt: '>' })[entity]);
  }
  return attributes;
}

function expandLightboxShortcodes(markdown, firstSourceLine) {
  const replacements = [];
  const expanded = markdown.replace(/\{\{<\s*lightbox\b([^\n]*?)>\}\}/gi, (shortcode, attributeText) => {
    const attributes = parseShortcodeAttributes(attributeText);
    if (!attributes.src) return shortcode;

    const src = escapeHtml(attributes.src);
    const thumb = escapeHtml(attributes.thumb || attributes.src);
    const alt = escapeHtml(attributes.alt || 'Image');
    const figure = `<figure class="lightbox"><a href="${src}" data-editor-lightbox><img src="${thumb}" alt="${alt}" loading="lazy"></a>${attributes.alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
    const placeholder = `@@EDITOR_LIGHTBOX_${replacements.length}@@`;
    replacements.push({ placeholder, figure });
    return placeholder;
  });

  // Add zero-height anchors before rendered blocks so scroll synchronization
  // can match content even when Markdown and HTML have very different heights.
  const tokens = marked.lexer(expanded, { breaks: false });
  const anchoredTokens = [];
  let sourceLine = firstSourceLine;
  for (const token of tokens) {
    if (token.type !== 'space' && token.type !== 'def') {
      anchoredTokens.push({
        type: 'html',
        raw: '',
        block: true,
        text: `<span class="preview-scroll-anchor" data-source-line="${sourceLine}"></span>`
      });
    }
    anchoredTokens.push(token);
    sourceLine += token.raw?.match(/\n/g)?.length || 0;
  }

  // Hugo's Goldmark renderer treats an ordinary source newline as whitespace,
  // not as an HTML <br>. This keeps URLs and other inline Markdown together.
  let html = marked.parser(anchoredTokens, { breaks: false });
  for (const { placeholder, figure } of replacements) {
    html = html.replace(`<p>${placeholder}</p>\n`, figure);
    html = html.replace(placeholder, figure);
  }
  return html;
}

export function renderMarkdownPreview(source) {
  const { content, startLine } = hugoContent(source);
  return expandLightboxShortcodes(expandHugoRefLinks(content), startLine);
}
