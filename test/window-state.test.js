const assert = require('node:assert/strict');
const test = require('node:test');
const { DEFAULT_WINDOW_STATE, normalizeWindowState } = require('../lib/window-state');

test('restores a saved window size and maximized state', () => {
  assert.deepEqual(normalizeWindowState({ width: 1280, height: 900, isMaximized: true }), {
    width: 1280,
    height: 900,
    isMaximized: true
  });
});

test('falls back from missing or invalid window state values', () => {
  assert.deepEqual(normalizeWindowState(null), DEFAULT_WINDOW_STATE);
  assert.deepEqual(normalizeWindowState({ width: 0, height: '900', isMaximized: 'yes' }), DEFAULT_WINDOW_STATE);
});
