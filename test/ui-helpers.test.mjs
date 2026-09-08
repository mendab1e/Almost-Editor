import assert from 'node:assert/strict';
import test from 'node:test';
import { mappedScrollTop, suggestPostDirectory, scrollFraction } from '../renderer/ui-helpers.mjs';
test('suggests portable directories from titles while retaining non-Latin words', () => {
  assert.equal(suggestPostDirectory('  Café / Film: 2026!  '), 'cafe-film-2026');
  assert.equal(suggestPostDirectory('日本の写真'), '日本の写真');
  assert.equal(suggestPostDirectory('../..'), '');
  assert.equal(suggestPostDirectory('a'.repeat(150)).length, 100);
});
test('scroll fractions handle short documents and overscroll', () => {
  assert.equal(scrollFraction({ scrollHeight: 100, clientHeight: 100, scrollTop: 0 }), 0);
  assert.equal(scrollFraction({ scrollHeight: 1000, clientHeight: 200, scrollTop: 400 }), .5);
  assert.equal(scrollFraction({ scrollHeight: 1000, clientHeight: 200, scrollTop: -10 }), 0);
  assert.equal(scrollFraction({ scrollHeight: 1000, clientHeight: 200, scrollTop: 900 }), 1);
});

test('maps scroll positions between corresponding content anchors', () => {
  const anchors = [
    { editor: 100, preview: 0 },
    { editor: 300, preview: 500 },
    { editor: 900, preview: 800 }
  ];
  assert.equal(mappedScrollTop(0, anchors, 'editor', 'preview'), 0);
  assert.equal(mappedScrollTop(200, anchors, 'editor', 'preview'), 250);
  assert.equal(mappedScrollTop(650, anchors, 'editor', 'preview'), 675);
  assert.equal(mappedScrollTop(1000, anchors, 'editor', 'preview'), 800);
  assert.equal(mappedScrollTop(0, anchors, 'preview', 'editor'), 100);
  assert.equal(mappedScrollTop(250, anchors, 'preview', 'editor'), 200);
  assert.equal(mappedScrollTop(800, anchors, 'preview', 'editor'), 900);
});
