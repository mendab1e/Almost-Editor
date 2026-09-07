export function dirtyDocumentsForClose(openDocuments, currentDocumentKey) {
  return Array.from(openDocuments.entries())
    .filter(([, document]) => document.dirty)
    .sort(([leftKey], [rightKey]) => {
      if (leftKey === currentDocumentKey) return 1;
      if (rightKey === currentDocumentKey) return -1;
      return 0;
    });
}

// If the draft changed during conversion, append rather than using a stale offset.
export function imageInsertion(content, originalContent, position, tag) {
  return { from: content === originalContent ? position : content.length, insert: `\n${tag}\n` };
}
