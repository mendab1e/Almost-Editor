const DEFAULT_WINDOW_STATE = {
  width: 1000,
  height: 720,
  isMaximized: false
};

function normalizeWindowState(state) {
  if (!state || typeof state !== 'object') return { ...DEFAULT_WINDOW_STATE };
  return {
    width: Number.isInteger(state.width) && state.width >= 400 ? state.width : DEFAULT_WINDOW_STATE.width,
    height: Number.isInteger(state.height) && state.height >= 300 ? state.height : DEFAULT_WINDOW_STATE.height,
    isMaximized: state.isMaximized === true
  };
}

module.exports = { DEFAULT_WINDOW_STATE, normalizeWindowState };
