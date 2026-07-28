const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openHugoProjectDialog: () => ipcRenderer.invoke('open-hugo-project-dialog'),
  openHugoPost: (payload) => ipcRenderer.invoke('open-hugo-post', payload),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  processImage: (payload) => ipcRenderer.invoke('process-image', payload),

  onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),
  onProjectOpened: (callback) => ipcRenderer.on('project-opened', (event, data) => callback(data)),
  onRequestSave: (callback) => ipcRenderer.on('request-save', () => callback(false)),
  onRequestSaveAs: (callback) => ipcRenderer.on('request-save-as', () => callback(true))
});
