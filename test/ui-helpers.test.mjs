import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestPostDirectory, scrollFraction } from '../renderer/ui-helpers.mjs';
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
