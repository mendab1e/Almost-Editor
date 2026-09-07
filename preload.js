const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  updateDocumentMenu: (documents) => ipcRenderer.invoke('update-document-menu', documents),
  onActivateDocument: (callback) => ipcRenderer.on('activate-document', (event, key) => callback(key)),
  setActiveFile: (payload) => ipcRenderer.invoke('set-active-file', payload),
  saveRecovery: (snapshot) => ipcRenderer.invoke('save-recovery', snapshot),
  onDraftsRecovered: (callback) => ipcRenderer.on('drafts-recovered', (event, snapshot) => callback(snapshot)),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (cfg) => ipcRenderer.invoke('save-config', cfg),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openHugoProjectDialog: () => ipcRenderer.invoke('open-hugo-project-dialog'),
  openHugoPost: (payload) => ipcRenderer.invoke('open-hugo-post', payload),
  createHugoPost: (payload) => ipcRenderer.invoke('create-hugo-post', payload),
  showHugoPostContextMenu: (payload) => ipcRenderer.invoke('show-hugo-post-context-menu', payload),
  saveFile: (payload) => ipcRenderer.invoke('save-file', payload),
  confirmWindowClose: (payload) => ipcRenderer.invoke('confirm-window-close', payload),
  finishWindowClose: (payload) => ipcRenderer.invoke('finish-window-close', payload),
  processImage: (payload) => ipcRenderer.invoke('process-image', payload),
  getPathForFile: (file) => webUtils.getPathForFile(file),

  onFileOpened: (callback) => ipcRenderer.on('file-opened', (event, data) => callback(data)),
  onProjectOpened: (callback) => ipcRenderer.on('project-opened', (event, data) => callback(data)),
  onHugoPostDeleted: (callback) => ipcRenderer.on('hugo-post-deleted', (event, data) => callback(data)),
  onRequestSave: (callback) => ipcRenderer.on('request-save', () => callback(false)),
  onRequestSaveAs: (callback) => ipcRenderer.on('request-save-as', () => callback(true)),
  onRequestWindowClose: (callback) => ipcRenderer.on('request-window-close', () => callback())
});
