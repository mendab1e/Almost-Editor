const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

app.setName('Almost Editor');

let mainWindow;
let currentFilePath = null; // path of the .md file currently open

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  // {src} = relative path to processed image, {alt} = alt text you type in the prompt
  tagTemplate: '![{alt}]({src}){: .post-image}',
  // Where processed images get saved, relative to the folder the .md file lives in
  imagesSubdir: 'images',
  // ImageMagick conversion settings
  maxWidth: 1600,
  outputFormat: 'webp', // e.g. webp, jpg, png
  quality: 82,
  theme: 'system',
  lastOpenedDirectory: null
};

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (err) {
    console.error('Failed to load config, using defaults:', err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const menu = Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => newFile() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFile() },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('request-save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('request-save-as') },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    }
  ]);
  Menu.setApplicationMenu(menu);
}

function newFile() {
  currentFilePath = null;
  mainWindow.webContents.send('file-opened', { filePath: null, content: '' });
}

function openFile() {
  const cfg = loadConfig();
  const result = dialog.showOpenDialogSync(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    // Start from the post currently being edited, or the last directory the
    // user opened a post from—even after the app has been restarted.
    defaultPath: currentFilePath ? path.dirname(currentFilePath) : cfg.lastOpenedDirectory || undefined
  });
  if (!result || !result[0]) return;
  const filePath = result[0];
  const content = fs.readFileSync(filePath, 'utf8');
  currentFilePath = filePath;
  saveConfig({ ...cfg, lastOpenedDirectory: path.dirname(filePath) });
  mainWindow.webContents.send('file-opened', { filePath, content });
}

// --- IPC handlers ---

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, cfg) => {
  saveConfig(cfg);
  return loadConfig();
});

ipcMain.handle('open-file-dialog', () => {
  openFile();
  return null;
});

ipcMain.handle('save-file', async (event, { content, filePath }) => {
  let targetPath = filePath || currentFilePath;
  if (!targetPath) {
    const cfg = loadConfig();
    targetPath = dialog.showSaveDialogSync(mainWindow, {
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: cfg.lastOpenedDirectory || undefined
    });
    if (!targetPath) return { ok: false };
  }
  fs.writeFileSync(targetPath, content, 'utf8');
  currentFilePath = targetPath;
  const cfg = loadConfig();
  saveConfig({ ...cfg, lastOpenedDirectory: path.dirname(targetPath) });
  return { ok: true, filePath: targetPath };
});

// Process a dropped/pasted image with ImageMagick and return the tag text to insert.
ipcMain.handle('process-image', async (event, { sourcePath, alt }) => {
  const cfg = loadConfig();

  if (!currentFilePath) {
    return { ok: false, error: 'Save your Markdown file first, so images have a folder to live next to.' };
  }

  const postDir = path.dirname(currentFilePath);
  const imagesDir = path.join(postDir, cfg.imagesSubdir);
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const safeName = baseName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  const outputName = `${safeName}-${Date.now()}.${cfg.outputFormat}`;
  const outputPath = path.join(imagesDir, outputName);

  const args = [
    sourcePath,
    '-resize', `${cfg.maxWidth}x>`, // only shrink, never enlarge
    '-strip'
  ];
  if (['jpg', 'jpeg', 'webp'].includes(cfg.outputFormat)) {
    args.push('-quality', String(cfg.quality));
  }
  args.push(outputPath);

  return new Promise((resolve) => {
    execFile('magick', args, (err, stdout, stderr) => {
      if (err) {
        // Fall back to legacy `convert` binary name if `magick` isn't on PATH
        execFile('convert', args, (err2, stdout2, stderr2) => {
          if (err2) {
            resolve({ ok: false, error: `ImageMagick failed: ${err2.message}. Is ImageMagick installed? (brew install imagemagick)` });
            return;
          }
          const relSrc = path.join(cfg.imagesSubdir, outputName);
          const tag = cfg.tagTemplate.replace('{alt}', alt || '').replace('{src}', relSrc);
          resolve({ ok: true, tag });
        });
        return;
      }
      const relSrc = path.join(cfg.imagesSubdir, outputName);
      const tag = cfg.tagTemplate.replace('{alt}', alt || '').replace('{src}', relSrc);
      resolve({ ok: true, tag });
    });
  });
});

app.whenReady().then(() => {
  if (!fs.existsSync(CONFIG_PATH)) saveConfig(DEFAULT_CONFIG);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
