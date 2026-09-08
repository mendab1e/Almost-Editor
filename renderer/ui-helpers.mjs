export function suggestPostDirectory(title) {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/, '');
}

export function scrollFraction(element) {
  const range = element.scrollHeight - element.clientHeight;
  return range > 0 ? Math.max(0, Math.min(1, element.scrollTop / range)) : 0;
}
