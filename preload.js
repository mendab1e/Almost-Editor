const { contextBridge, ipcRenderer } = require('electron');
const { marked } = require('marked');

marked.setOptions({ breaks: true }); // treat single newlines as <br>, closer to how most blog engines render drafts

// Front matter is consumed by Hugo before it hands the page body to Goldmark.
// Marked does not know about it, and would otherwise render a Hugo document's
// opening `---` as an <hr> and its title as a heading.
function withoutHugoFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)\s*\r?\n[\s\S]*?\r?\n\1\s*(?:\r?\n|$)/);
  return match ? source.slice(match[0].length) : source;
}

function renderMarkdown(text) {
  return marked.parse(withoutHugoFrontMatter(text));
}

contextBridge.exposeInMainWorld('api', {
  renderMarkdown,
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  processImage: (payload) => ipcRenderer.invoke('process-image', payload),

  onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),
  onRequestSave: (callback) => ipcRenderer.on('request-save', () => callback(false)),
  onRequestSaveAs: (callback) => ipcRenderer.on('request-save-as', () => callback(true))
});
