const assert = require('node:assert/strict');
const test = require('node:test');
const { buildImageShortcode, buildMogrifyArgs, isGifPath } = require('../lib/image-processing');

test('builds the ImageMagick mogrify command for a JPEG output', () => {
  assert.deepEqual(
    buildMogrifyArgs('/tmp/scan.png', '/post/images', '1500x1500', 70),
    ['mogrify', '-path', '/post/images', '-format', 'jpg', '-resize', '1500x1500', '-quality', '70', '/tmp/scan.png']
  );
});

test('recognizes GIF files that must bypass ImageMagick', () => {
  assert.equal(isGifPath('/tmp/animation.gif'), true);
  assert.equal(isGifPath('/tmp/animation.GIF'), true);
  assert.equal(isGifPath('/tmp/still.png'), false);
});

test('builds an image shortcode from the configured template', () => {
  assert.equal(
    buildImageShortcode(
      '{{< lightbox src="{src}" thumb="{thumb}" alt="{alt}" >}}',
      { src: 'images/scan.jpg', thumb: 'images/scan_thumb.jpg', alt: '' }
    ),
    '{{< lightbox src="images/scan.jpg" thumb="images/scan_thumb.jpg" alt="" >}}'
  );
});

test('supports templates that omit optional image placeholders', () => {
  assert.equal(
    buildImageShortcode('![{alt}]({src})', {
      src: 'images/scan.jpg',
      thumb: 'images/scan_thumb.jpg',
      alt: 'Scan'
    }),
    '![Scan](images/scan.jpg)'
  );
});

test('reserves unique image pairs without overwriting existing thumbnails or GIFs', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { reserveImagePaths } = require('../lib/image-processing');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'image-reservation-'));
  try {
    fs.writeFileSync(path.join(directory, 'photo_thumb.jpg'), 'original');
    const first = reserveImagePaths(directory, 'photo', false);
    const second = reserveImagePaths(directory, 'photo', false);
    assert.deepEqual(first.map(p => path.basename(p)), ['photo-1.jpg', 'photo-1_thumb.jpg']);
    assert.deepEqual(second.map(p => path.basename(p)), ['photo-2.jpg', 'photo-2_thumb.jpg']);
    assert.equal(fs.readFileSync(path.join(directory, 'photo_thumb.jpg'), 'utf8'), 'original');
    assert.equal(fs.existsSync(path.join(directory, 'photo.jpg')), false);
    assert.notEqual(reserveImagePaths(directory, 'photo', true)[0], reserveImagePaths(directory, 'photo', true)[0]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
