import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildMarkdownLink,
  formatMarkdownBlock,
  insertMarkdownBlock,
  insertGallery,
  wrapMarkdownSelection
} from '../renderer/markdown-editing.mjs';

test('wraps selected text and keeps the content selected', () => {
  assert.deepEqual(wrapMarkdownSelection('Make this bold', 5, 9, '**'), {
    from: 5,
    to: 9,
    insert: '**this**',
    selectionStart: 7,
    selectionEnd: 11
  });
});

test('inserts an editable placeholder when an inline selection is empty', () => {
  assert.deepEqual(wrapMarkdownSelection('', 0, 0, '`', '`', 'code'), {
    from: 0,
    to: 0,
    insert: '`code`',
    selectionStart: 1,
    selectionEnd: 5
  });
});

test('applies Markdown block styles across selected lines', () => {
  assert.deepEqual(formatMarkdownBlock('one\ntwo\nthree', 2, 9, 'ordered'), {
    from: 0,
    to: 13,
    insert: '1. one\n2. two\n3. three',
    selectionStart: 0,
    selectionEnd: 22
  });
  assert.equal(formatMarkdownBlock('## Heading', 0, 10, 'paragraph').insert, 'Heading');
});

test('inserts fenced code as a separate block', () => {
  assert.equal(
    insertMarkdownBlock('Before', 6, 6, (content) => `\`\`\`\n${content}\n\`\`\``, 'code').insert,
    '\n\n```\ncode\n```\n'
  );
});

test('builds direct and Hugo article links', () => {
  assert.equal(buildMarkdownLink('OpenAI', { type: 'url', value: 'https://openai.com' }), '[OpenAI](https://openai.com)');
  assert.equal(
    buildMarkdownLink('Film scanning', { type: 'post', value: 'archive/film-scanning' }),
    '[Film scanning]({{< ref "/posts/archive/film-scanning" >}})'
  );
});

test('formats the first blank line without creating a reversed selection', () => {
  const edit = formatMarkdownBlock('\nHello', 0, 0, 'h1');
  assert.equal(edit.from, 0);
  assert.equal(edit.to, 0);
  assert.equal(edit.insert, '# Text');
});

test('gallery insertion wraps selected photos and places an empty cursor inside the wrapper', () => {
  const photo = '{{< lightbox src="one.jpg" >}}';
  const wrapped = insertGallery(photo, 0, photo.length);
  assert.equal(wrapped.insert, `{{< gallery >}}\n${photo}\n{{< /gallery >}}\n`);
  assert.equal(wrapped.insert.slice(wrapped.selectionStart, wrapped.selectionEnd), photo);
  const empty = insertGallery('BeforeAfter', 6, 6);
  assert.equal(empty.insert, '\n\n{{< gallery >}}\n\n{{< /gallery >}}\n\n');
  assert.equal(empty.selectionStart, empty.selectionEnd);
  assert.equal(empty.selectionStart, 6 + '\n\n{{< gallery >}}\n'.length);
});
