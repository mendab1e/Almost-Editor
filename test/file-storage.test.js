const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { atomicWrite, readRecovery } = require('../lib/file-storage');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-storage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'index.md');
}

test('atomic saving replaces content and retains existing permissions', t => {
  const target = fixture(t);
  fs.writeFileSync(target, 'original', { mode: 0o640 });
  atomicWrite(target, 'new draft', { expectedContent: 'original' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'new draft');
  assert.equal(fs.statSync(target).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(path.dirname(target)), ['index.md']);
});

test('conflicting external edits and deletions are not overwritten', t => {
  const target = fixture(t);
  fs.writeFileSync(target, 'external change');
  assert.throws(() => atomicWrite(target, 'draft', { expectedContent: 'original' }), { code: 'CONFLICT' });
  assert.equal(fs.readFileSync(target, 'utf8'), 'external change');
  fs.unlinkSync(target);
  assert.throws(() => atomicWrite(target, 'draft', { expectedContent: 'original' }), { code: 'CONFLICT' });
  assert.deepEqual(fs.readdirSync(path.dirname(target)), []);
});

test('failed temporary writes or renames preserve the original and clean temporary files', t => {
  const target = fixture(t);
  fs.writeFileSync(target, 'original');
  for (const operation of ['writeFileSync', 'renameSync']) {
    const io = { ...fs, [operation]() { throw new Error('simulated failure'); } };
    assert.throws(() => atomicWrite(target, 'draft', { expectedContent: 'original', io }), /simulated failure/);
    assert.equal(fs.readFileSync(target, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(path.dirname(target)), ['index.md']);
  }
});

test('recovery snapshots round-trip drafts and do not replace malformed data', t => {
  const target = fixture(t);
  const snapshot = { activeKey: 'draft:1', documents: [{ key: 'draft:1', filePath: null,
    projectPath: null, content: 'unsaved writing', savedContent: '' }] };
  assert.deepEqual(readRecovery(target).documents, []);
  atomicWrite(target, JSON.stringify(snapshot));
  assert.deepEqual(readRecovery(target), snapshot);
  fs.writeFileSync(target, 'broken JSON');
  assert.throws(() => readRecovery(target));
  assert.equal(fs.readFileSync(target, 'utf8'), 'broken JSON');
});
