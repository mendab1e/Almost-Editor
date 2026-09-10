// Refresh clean buffers from disk, but keep unsaved content when reopening a file.
export function openDocumentState(documents, key, { filePath, content, projectPath = null }) {
  let document = documents.get(key);
  if (!document) {
    document = { savedContent: content, content, dirty: false, filePath, projectPath };
    documents.set(key, document);
  } else {
    if (!document.dirty) {
      document.savedContent = content;
      document.content = content;
    }
    document.projectPath = projectPath;
  }
  return document;
}

export function dirtyDocumentsForClose(openDocuments, currentDocumentKey) {
  return Array.from(openDocuments.entries())
    .filter(([, document]) => document.dirty)
    .sort(([leftKey], [rightKey]) => {
      if (leftKey === currentDocumentKey) return 1;
      if (rightKey === currentDocumentKey) return -1;
      return 0;
    });
}

function normalizedPath(filePath) {
  return typeof filePath === 'string' ? filePath.replaceAll('\\', '/').replace(/\/+$/, '') : '';
}

export function documentKeysInDirectory(documents, directoryPath) {
  const directory = normalizedPath(directoryPath);
  if (!directory) return [];
  const prefix = `${directory}/`;
  return Array.from(documents)
    .filter(([, document]) => normalizedPath(document.filePath).startsWith(prefix))
    .map(([key]) => key);
}

export function removeDocumentsInDirectory(documents, directoryPath) {
  const keys = documentKeysInDirectory(documents, directoryPath);
  keys.forEach(key => documents.delete(key));
  return keys;
}

// If the draft changed during conversion, append rather than using a stale offset.
export function imageInsertion(content, originalContent, position, tag) {
  return { from: content === originalContent ? position : content.length, insert: `\n${tag}\n` };
}

export function completeDocumentSave(documents, document, savedContent, filePath) {
  const entry = Array.from(documents).find(([, value]) => value === document);
  if (!entry) return null;
  const [oldKey] = entry;
  const destination = documents.get(filePath);
  // A different draft must never be evicted by a Save As response.
  if (destination && destination !== document && destination.dirty) {
    throw new Error('Another open draft already uses this file.');
  }
  document.savedContent = savedContent;
  document.dirty = document.content !== savedContent;
  document.filePath = filePath;
  if (oldKey !== filePath) documents.delete(oldKey);
  documents.set(filePath, document);
  return { oldKey, key: filePath };
}

export function recoverySnapshot(documents, activeKey) {
  return {
    activeKey,
    documents: Array.from(documents)
      .filter(([, document]) => document.dirty)
      .map(([key, document]) => ({ key, filePath: document.filePath, projectPath: document.projectPath,
        content: document.content, savedContent: document.savedContent }))
  };
}
