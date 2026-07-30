function buildMogrifyArgs(inputPath, outputDirectory, resize, quality) {
  return ['mogrify', '-path', outputDirectory, '-format', 'jpg', '-resize', resize, '-quality', String(quality), inputPath];
}

function buildImageShortcode(template, { src, thumb, alt = '' }) {
  const values = { src, thumb, alt };
  return Object.entries(values).reduce(
    (result, [name, value]) => result.split(`{${name}}`).join(String(value)),
    template
  );
}

module.exports = { buildImageShortcode, buildMogrifyArgs };
