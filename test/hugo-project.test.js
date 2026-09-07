const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  createHugoFrontMatter,
  isValidPostName,
  listHugoPosts,
  resolveHugoPostDirectory,
  resolveHugoPostPath
} = require('../lib/hugo-project');

test('lists nested Hugo page bundles and skips directories without index.md', (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'almost-editor-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const posts = path.join(project, 'content', 'posts');
  fs.mkdirSync(path.join(posts, 'film-scanning'), { recursive: true });
  fs.mkdirSync(path.join(posts, 'archive', 'old-post'), { recursive: true });
  fs.mkdirSync(path.join(posts, 'not-a-post'), { recursive: true });
  fs.writeFileSync(path.join(posts, 'film-scanning', 'index.md'), '+++\n+++\n');
  fs.writeFileSync(path.join(posts, 'archive', 'old-post', 'index.md'), '+++\n+++\n');

  assert.deepEqual(listHugoPosts(project), [
    { name: 'archive/old-post', relativePath: 'archive/old-post' },
    { name: 'film-scanning', relativePath: 'film-scanning' }
  ]);
});

test('rejects a project without content/posts', (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'almost-editor-project-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  assert.throws(() => listHugoPosts(project), /content\/posts/);
});

test('validates page bundle directory names', () => {
  assert.equal(isValidPostName('film-scanning'), true);
  assert.equal(isValidPostName(''), false);
  assert.equal(isValidPostName('../escape'), false);
  assert.equal(isValidPostName('nested/post'), false);
});

test('resolves nested posts without allowing paths outside content/posts', () => {
  const project = path.join(os.tmpdir(), 'almost-editor-project');
  assert.equal(
    resolveHugoPostDirectory(project, 'archive/old-post'),
    path.join(project, 'content', 'posts', 'archive', 'old-post')
  );
  assert.equal(
    resolveHugoPostPath(project, 'archive/old-post'),
    path.join(project, 'content', 'posts', 'archive', 'old-post', 'index.md')
  );
  assert.equal(resolveHugoPostDirectory(project, '../../../outside'), null);
  assert.equal(resolveHugoPostDirectory(project, '..'), null);
  assert.equal(resolveHugoPostDirectory(project, ''), null);
  assert.equal(resolveHugoPostPath(project, '../../../outside'), null);
  assert.equal(resolveHugoPostPath(project, ''), null);
});

test('creates the expected TOML front matter', () => {
  assert.equal(createHugoFrontMatter('Film scanning', '2026-07-28'), [
    '+++',
    'author = ""',
    'title = "Film scanning"',
    'date = "2026-07-28"',
    'description = ""',
    'tags = []',
    '+++',
    ''
  ].join('\n'));
});
