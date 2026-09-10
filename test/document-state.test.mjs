import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dirtyDocumentsForClose,
  documentKeysInDirectory,
  removeDocumentsInDirectory
} from '../renderer/document-state.mjs';

test('returns every dirty document and saves the current document last', () => {
  const documents = new Map([
    ['/posts/current/index.md', { dirty: true }],
    ['/posts/clean/index.md', { dirty: false }],
    ['/posts/other/index.md', { dirty: true }]
  ]);

  assert.deepEqual(
    dirtyDocumentsForClose(documents, '/posts/current/index.md').map(([key]) => key),
    ['/posts/other/index.md', '/posts/current/index.md']
  );
});

test('returns an empty list when no documents are dirty', () => {
  const documents = new Map([['__untitled__', { dirty: false }]]);
  assert.deepEqual(dirtyDocumentsForClose(documents, '__untitled__'), []);
});

test('finds and removes every open document inside a deleted post directory', () => {
  const documents = new Map([
    ['/project/content/posts/parent/index.md', { filePath: '/project/content/posts/parent/index.md' }],
    ['/project/content/posts/parent/child/index.md', { filePath: '/project/content/posts/parent/child/index.md' }],
    ['/project/content/posts/parenthetical/index.md', { filePath: '/project/content/posts/parenthetical/index.md' }],
    ['draft:1', { filePath: null }]
  ]);

  assert.deepEqual(documentKeysInDirectory(documents, '/project/content/posts/parent'), [
    '/project/content/posts/parent/index.md',
    '/project/content/posts/parent/child/index.md'
  ]);
  assert.deepEqual(removeDocumentsInDirectory(documents, '/project/content/posts/parent'), [
    '/project/content/posts/parent/index.md',
    '/project/content/posts/parent/child/index.md'
  ]);
  assert.deepEqual(Array.from(documents.keys()), [
    '/project/content/posts/parenthetical/index.md',
    'draft:1'
  ]);
});

import { imageInsertion } from '../renderer/document-state.mjs';
test('image insertion preserves its original position or appends after intervening edits', () => {
  assert.deepEqual(imageInsertion('abc', 'abc', 1, 'tag'), { from: 1, insert: '\ntag\n' });
  assert.equal(imageInsertion('changed draft', 'abc', 1, 'tag').from, 13);
});

import { completeDocumentSave, recoverySnapshot } from '../renderer/document-state.mjs';
test('save completion retains newer edits and does not replace other document state', () => {
  const first = { content: 'newer edit', savedContent: 'old', dirty: true, filePath: '/a.md', projectPath: null };
  const second = { content: 'other draft', dirty: true };
  const documents = new Map([['/a.md', first], ['/b.md', second]]);
  completeDocumentSave(documents, first, 'saved snapshot', '/a.md');
  assert.equal(first.savedContent, 'saved snapshot');
  assert.equal(first.content, 'newer edit');
  assert.equal(first.dirty, true);
  assert.equal(documents.get('/b.md'), second);
});

test('saving an untitled draft migrates only that draft and recovery keeps remaining dirty documents', () => {
  const first = { content: 'first', savedContent: '', dirty: true, filePath: null, projectPath: null };
  const second = { content: 'second', savedContent: '', dirty: true, filePath: null, projectPath: null };
  const documents = new Map([['draft:1', first], ['draft:2', second]]);
  completeDocumentSave(documents, first, 'first', '/saved.md');
  assert.equal(documents.has('draft:1'), false);
  assert.equal(documents.get('draft:2'), second);
  assert.equal(documents.get('/saved.md').dirty, false);
  assert.deepEqual(recoverySnapshot(documents, 'draft:2').documents.map(d => d.key), ['draft:2']);
});

import { openDocumentState } from '../renderer/document-state.mjs';
test('reopening preserves dirty content and records the explicitly requested project context', () => {
  const documents = new Map();
  const draft = openDocumentState(documents, '/a.md', { filePath: '/a.md', content: 'disk', projectPath: '/project' });
  draft.content = 'unsaved';
  draft.dirty = true;
  assert.equal(openDocumentState(documents, '/a.md', { filePath: '/a.md', content: 'external' }), draft);
  assert.equal(draft.content, 'unsaved');
  assert.equal(draft.savedContent, 'disk');
  assert.equal(draft.projectPath, null);
  assert.equal(draft.dirty, true);
});

test('reopening clean documents refreshes their saved baseline and keeps other drafts', () => {
  const documents = new Map();
  const other = openDocumentState(documents, 'draft:other', { filePath: null, content: '' });
  openDocumentState(documents, '/a.md', { filePath: '/a.md', content: 'old' });
  const refreshed = openDocumentState(documents, '/a.md', { filePath: '/a.md', content: 'new', projectPath: '/project' });
  assert.deepEqual(refreshed, { filePath: '/a.md', content: 'new', savedContent: 'new', dirty: false, projectPath: '/project' });
  assert.equal(documents.get('draft:other'), other);
});
