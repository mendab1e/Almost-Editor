import DOMPurify from 'dompurify';

export function sanitizePreview(html) {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'ul', 'ol', 'li', 'pre', 'code', 'strong', 'em', 'del', 's', 'a', 'img',
      'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'start', 'align',
      'colspan', 'rowspan', 'type', 'checked', 'disabled', 'loading', 'data-editor-lightbox'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|file|hugo-ref):|[^:]*$)/i
  });
}
