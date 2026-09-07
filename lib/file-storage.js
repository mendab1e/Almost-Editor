const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function readText(filePath, io = fs) {
  try { return io.readFileSync(filePath, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// A same-directory rename prevents a failed write from truncating the original.
function atomicWrite(filePath, content, { expectedContent, io = fs } = {}) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  let descriptor;
  try {
    let mode = 0o600;
    try { mode = io.statSync(filePath).mode & 0o777; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    descriptor = io.openSync(temporary, 'wx', mode);
    io.writeFileSync(descriptor, content, 'utf8');
    io.fsyncSync(descriptor);
    io.closeSync(descriptor);
    descriptor = undefined;
    // Check immediately before replacement, including deletion of an opened file.
    if (expectedContent !== undefined && readText(filePath, io) !== expectedContent) {
      const error = new Error('The file changed on disk. Save a copy to keep both versions.');
      error.code = 'CONFLICT';
      throw error;
    }
    io.renameSync(temporary, filePath);
  } finally {
    if (descriptor !== undefined) io.closeSync(descriptor);
    io.rmSync(temporary, { force: true });
  }
}

function readRecovery(filePath) {
  const source = readText(filePath);
  if (source === null) return { documents: [], activeKey: null };
  const snapshot = JSON.parse(source);
  if (!snapshot || !Array.isArray(snapshot.documents) || !snapshot.documents.every(validDraft)) {
    throw new Error('Invalid recovery snapshot');
  }
  return snapshot;
}

function validDraft(draft) {
  return draft && typeof draft.key === 'string' && typeof draft.content === 'string' &&
    typeof draft.savedContent === 'string' &&
    (draft.filePath === null || (typeof draft.filePath === 'string' && path.isAbsolute(draft.filePath))) &&
    (draft.projectPath === null || typeof draft.projectPath === 'string');
}

module.exports = { atomicWrite, readText, readRecovery, validDraft };
