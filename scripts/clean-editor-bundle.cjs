const fs = require('node:fs');
const path = require('node:path');

const bundlePath = path.join(__dirname, '..', 'renderer', 'editor.bundle.js');
const bundle = fs.readFileSync(bundlePath, 'utf8');

// Some dependency comments contain whitespace-only lines. Keep the tracked
// generated bundle compatible with the repository's diff hygiene checks.
fs.writeFileSync(bundlePath, bundle.replace(/[ \t]+$/gm, ''));
