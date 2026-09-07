const fs = require('fs');
const path = require('path');

function buildMogrifyArgs(inputPath, outputDirectory, resize, quality) {
  return ['mogrify', '-path', outputDirectory, '-format', 'jpg', '-resize', resize, '-quality', String(quality), inputPath];
}

function isGifPath(filePath) {
  return path.extname(filePath).toLowerCase() === '.gif';
}

function buildImageShortcode(template, { src, thumb, alt = '' }) {
  const values = { src, thumb, alt };
  return Object.entries(values).reduce(
    (result, [name, value]) => result.split(`{${name}}`).join(String(value)),
    template
  );
}

module.exports = { buildImageShortcode, buildMogrifyArgs, isGifPath };

// Reserve the entire pair exclusively so simultaneous imports cannot share names.
function reserveImagePaths(directory, baseName, gif) {
  for (let suffix = 0; ; suffix++) {
    const name = `${baseName || 'image'}${suffix ? `-${suffix}` : ''}`;
    const names = gif ? [`${name}.gif`] : [`${name}.jpg`, `${name}_thumb.jpg`];
    const reserved = [];
    try {
      for (const name of names) {
        const filePath = path.join(directory, name);
        fs.closeSync(fs.openSync(filePath, 'wx'));
        reserved.push(filePath);
      }
      return reserved;
    } catch (error) {
      reserved.forEach((filePath) => fs.unlinkSync(filePath));
      if (error.code !== 'EEXIST') throw error;
    }
  }
}
module.exports.reserveImagePaths = reserveImagePaths;
