import assert from 'node:assert/strict';
import test from 'node:test';
import { dirtyDocumentsForClose } from '../renderer/document-state.mjs';

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

import { imageInsertion } from '../renderer/document-state.mjs';
test('image insertion preserves its original position or appends after intervening edits', () => {
  assert.deepEqual(imageInsertion('abc', 'abc', 1, 'tag'), { from: 1, insert: '\ntag\n' });
  assert.equal(imageInsertion('changed draft', 'abc', 1, 'tag').from, 13);
});
