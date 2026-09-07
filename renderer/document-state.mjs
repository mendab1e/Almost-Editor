export function dirtyDocumentsForClose(openDocuments, currentDocumentKey) {
  return Array.from(openDocuments.entries())
    .filter(([, document]) => document.dirty)
    .sort(([leftKey], [rightKey]) => {
      if (leftKey === currentDocumentKey) return 1;
      if (rightKey === currentDocumentKey) return -1;
      return 0;
    });
}
