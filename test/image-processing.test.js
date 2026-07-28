const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMogrifyArgs } = require('../lib/image-processing');

test('builds the ImageMagick mogrify command for a JPEG output', () => {
  assert.deepEqual(
    buildMogrifyArgs('/tmp/scan.png', '/post/images', '1500x1500', 70),
    ['mogrify', '-path', '/post/images', '-format', 'jpg', '-resize', '1500x1500', '-quality', '70', '/tmp/scan.png']
  );
});
