export function suggestPostDirectory(title) {
  return title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/, '');
}

export function scrollFraction(element) {
  const range = element.scrollHeight - element.clientHeight;
  return range > 0 ? Math.max(0, Math.min(1, element.scrollTop / range)) : 0;
}

export function mappedScrollTop(position, anchors, sourceKey, targetKey) {
  if (!anchors.length) return 0;
  if (position <= anchors[0][sourceKey]) return anchors[0][targetKey];
  if (position >= anchors.at(-1)[sourceKey]) return anchors.at(-1)[targetKey];

  for (let index = 1; index < anchors.length; index += 1) {
    const before = anchors[index - 1];
    const after = anchors[index];
    if (position > after[sourceKey]) continue;
    const distance = after[sourceKey] - before[sourceKey];
    if (distance <= 0) return after[targetKey];
    const fraction = (position - before[sourceKey]) / distance;
    return before[targetKey] + fraction * (after[targetKey] - before[targetKey]);
  }

  return anchors.at(-1)[targetKey];
}
