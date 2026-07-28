function buildMogrifyArgs(inputPath, outputDirectory, resize, quality) {
  return ['mogrify', '-path', outputDirectory, '-format', 'jpg', '-resize', resize, '-quality', String(quality), inputPath];
}

module.exports = { buildMogrifyArgs };
