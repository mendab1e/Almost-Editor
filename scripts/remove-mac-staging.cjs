const fs = require('fs');
const path = require('path');

const stagingDirectory = path.join(__dirname, '..', 'dist', 'mac-arm64');

fs.rmSync(stagingDirectory, { recursive: true, force: true });
console.log('Removed unpacked macOS staging app from dist/mac-arm64.');
