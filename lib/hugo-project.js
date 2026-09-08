const fs = require('fs');
const path = require('path');

function listHugoPosts(projectPath) {
  const postsRoot = path.join(projectPath, 'content', 'posts');
  if (!fs.existsSync(postsRoot) || !fs.statSync(postsRoot).isDirectory()) {
    throw new Error('This folder does not contain content/posts. Select your Hugo project root.');
  }

  const posts = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      const indexPath = path.join(fullPath, 'index.md');
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        const relativePath = path.relative(postsRoot, fullPath);
        if (!fs.realpathSync(indexPath).startsWith(fs.realpathSync(postsRoot) + path.sep)) continue;
        const content = fs.readFileSync(indexPath, 'utf8');
        const frontMatter = content.match(/^(\+\+\+|---)[ \t]*\r?\n(?:[\s\S]*?\r?\n)?\1[ \t]*(?:\r?\n|$)/)?.[0] || '';
        posts.push({ name: relativePath, relativePath, frontMatter });
      }
      walk(fullPath);
    }
  }

  walk(postsRoot);
  return posts.sort((a, b) => a.name.localeCompare(b.name));
}

function isValidPostName(name) {
  return Boolean(name && name !== '.' && name !== '..' && path.basename(name) === name);
}

function resolveHugoPostPath(projectPath, relativePath) {
  const postDirectory = resolveHugoPostDirectory(projectPath, relativePath);
  return postDirectory ? path.join(postDirectory, 'index.md') : null;
}

function resolveHugoPostDirectory(projectPath, relativePath) {
  if (typeof projectPath !== 'string' || typeof relativePath !== 'string' || !relativePath) return null;
  const postsRoot = path.resolve(projectPath, 'content', 'posts');
  const postDirectory = path.resolve(postsRoot, relativePath);
  return postDirectory.startsWith(`${postsRoot}${path.sep}`) ? postDirectory : null;
}

function createHugoFrontMatter(postName, date) {
  return [
    '+++',
    'author = ""',
    `title = ${JSON.stringify(postName)}`,
    `date = "${date}"`,
    'description = ""',
    'tags = []',
    '+++',
    ''
  ].join('\n');
}

module.exports = {
  createHugoFrontMatter,
  isValidPostName,
  listHugoPosts,
  resolveHugoPostDirectory,
  resolveHugoPostPath
};
