const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const {
  createHugoFrontMatter,
  isValidPostName,
  listHugoPosts,
  resolveHugoPostPath
} = require('./lib/hugo-project');
const { buildImageShortcode, buildMogrifyArgs, isGifPath } = require('./lib/image-processing');
const { normalizeWindowState } = require('./lib/window-state');

app.setName('Almost Editor');

let mainWindow;
let currentFilePath = null; // path of the .md file currently open
let allowWindowClose = false;
let isQuitting = false;

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  // Where processed images get saved, relative to the folder the .md file lives in
  imagesSubdir: 'images',
  imageResize: '1500x1500',
  imageQuality: 70,
  thumbnailResize: '500x500',
  thumbnailQuality: 60,
  imageShortcodeTemplate: '{{< lightbox src="{src}" thumb="{thumb}" alt="{alt}" >}}',
  theme: 'system',
  fontSize: 15,
  lastOpenedDirectory: null,
  lastHugoProject: null,
  lastHugoPost: null,
  windowState: null
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
  allowWindowClose = false;
  const windowState = normalizeWindowState(loadConfig().windowState);
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (windowState.isMaximized) mainWindow.maximize();
  mainWindow.webContents.once('did-finish-load', restoreLastSession);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => newFile() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFile() },
        { label: 'Open Hugo Project…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openHugoProject() },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('request-save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('request-save-as') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'windowMenu' }
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.on('close', (event) => {
    if (allowWindowClose) {
      persistWindowState();
      return;
    }
    event.preventDefault();
    mainWindow.webContents.send('request-window-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    currentFilePath = null;
  });
}

function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getNormalBounds();
  const cfg = loadConfig();
  saveConfig({
    ...cfg,
    windowState: {
      width: bounds.width,
      height: bounds.height,
      isMaximized: mainWindow.isMaximized()
    }
  });
}

function newFile() {
  currentFilePath = null;
  mainWindow.webContents.send('file-opened', { filePath: null, content: '', projectPath: null });
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
  mainWindow.webContents.send('file-opened', { filePath, content, projectPath: null });
}

function sendProjectOpened(projectPath) {
  const posts = listHugoPosts(projectPath);
  mainWindow.webContents.send('project-opened', { projectPath, posts });
  return { ok: true, projectPath, posts };
}

function openHugoPost(projectPath, relativePath, remember = true) {
  const postPath = resolveHugoPostPath(projectPath, relativePath);
  if (!postPath || !fs.existsSync(postPath) || !fs.statSync(postPath).isFile()) {
    return { ok: false, error: 'The selected post could not be found.' };
  }
  const content = fs.readFileSync(postPath, 'utf8');
  currentFilePath = postPath;
  if (remember) {
    const cfg = loadConfig();
    saveConfig({
      ...cfg,
      lastOpenedDirectory: path.dirname(postPath),
      lastHugoProject: projectPath,
      lastHugoPost: relativePath
    });
  }
  mainWindow.webContents.send('file-opened', { filePath: postPath, content, projectPath });
  return { ok: true, filePath: postPath };
}

function restoreLastSession() {
  const { lastHugoProject, lastHugoPost } = loadConfig();
  if (!lastHugoProject || !fs.existsSync(lastHugoProject)) return;
  try {
    sendProjectOpened(lastHugoProject);
    if (lastHugoPost) openHugoPost(lastHugoProject, lastHugoPost, false);
  } catch (error) {
    console.error('Failed to restore Hugo project:', error);
  }
}

function openHugoProject() {
  const cfg = loadConfig();
  const result = dialog.showOpenDialogSync(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: cfg.lastHugoProject || cfg.lastOpenedDirectory || undefined,
    title: 'Open Hugo Project'
  });
  if (!result || !result[0]) return { ok: false };
  try {
    const projectPath = result[0];
    const payload = sendProjectOpened(projectPath);
    saveConfig({
      ...cfg,
      lastHugoProject: projectPath,
      lastHugoPost: cfg.lastHugoProject === projectPath ? cfg.lastHugoPost : null
    });
    return payload;
  } catch (error) {
    dialog.showErrorBox('Cannot open Hugo project', error.message);
    return { ok: false, error: error.message };
  }
}

// --- IPC handlers ---

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, cfg) => {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return loadConfig();
  saveConfig({ ...loadConfig(), ...cfg });
  return loadConfig();
});

ipcMain.handle('open-file-dialog', () => {
  openFile();
  return null;
});

ipcMain.handle('open-hugo-project-dialog', () => openHugoProject());

ipcMain.handle('open-hugo-post', (event, { projectPath, relativePath }) => (
  openHugoPost(projectPath, relativePath)
));

ipcMain.handle('create-hugo-post', (event, { projectPath, name }) => {
  const postName = String(name || '').trim();
  if (!isValidPostName(postName)) {
    return { ok: false, error: 'Enter a valid post directory name without path separators.' };
  }

  const postsRoot = path.resolve(projectPath, 'content', 'posts');
  if (!fs.existsSync(postsRoot) || !fs.statSync(postsRoot).isDirectory()) {
    return { ok: false, error: 'The Hugo project no longer contains content/posts.' };
  }

  const postDirectory = path.join(postsRoot, postName);
  if (fs.existsSync(postDirectory)) {
    return { ok: false, error: `A post directory named “${postName}” already exists.` };
  }

  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const frontMatter = createHugoFrontMatter(postName, date);

  try {
    fs.mkdirSync(path.join(postDirectory, 'images'), { recursive: true });
    const indexPath = path.join(postDirectory, 'index.md');
    fs.writeFileSync(indexPath, frontMatter, 'utf8');
    currentFilePath = indexPath;
    const cfg = loadConfig();
    saveConfig({
      ...cfg,
      lastOpenedDirectory: postDirectory,
      lastHugoProject: projectPath,
      lastHugoPost: postName
    });
    sendProjectOpened(projectPath);
    mainWindow.webContents.send('file-opened', { filePath: indexPath, content: frontMatter, projectPath });
    return { ok: true, filePath: indexPath };
  } catch (error) {
    return { ok: false, error: `Could not create post: ${error.message}` };
  }
});

ipcMain.handle('save-file', async (event, { content, filePath, forcePicker = false, updateCurrentFile = true }) => {
  let targetPath = forcePicker ? null : filePath || currentFilePath;
  if (!targetPath) {
    const cfg = loadConfig();
    targetPath = dialog.showSaveDialogSync(mainWindow, {
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: cfg.lastOpenedDirectory || undefined
    });
    if (!targetPath) return { ok: false };
  }
  fs.writeFileSync(targetPath, content, 'utf8');
  if (updateCurrentFile) currentFilePath = targetPath;
  const cfg = loadConfig();
  saveConfig({ ...cfg, lastOpenedDirectory: path.dirname(targetPath) });
  return { ok: true, filePath: targetPath };
});

ipcMain.handle('confirm-window-close', async (event, { dirtyCount }) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { action: 'cancel' };
  const count = Number.isInteger(dirtyCount) && dirtyCount > 0 ? dirtyCount : 1;
  const saveLabel = count === 1 ? 'Save' : 'Save All';
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: [saveLabel, 'Don’t Save', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: count === 1
      ? 'Do you want to save your changes before closing?'
      : `Do you want to save changes to ${count} documents before closing?`,
    detail: 'Your changes will be lost if you don’t save them.'
  });
  const action = ['save', 'discard', 'cancel'][result.response] || 'cancel';
  if (action === 'cancel') isQuitting = false;
  return { action };
});

ipcMain.handle('finish-window-close', (event, { close }) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  if (!close) {
    isQuitting = false;
    return { ok: true };
  }
  allowWindowClose = true;
  if (isQuitting) app.quit();
  else mainWindow.close();
  return { ok: true };
});

function mogrifyImage(inputPath, outputDirectory, resize, quality) {
  // Finder-launched apps do not always inherit Homebrew's PATH. Prefer the
  // standard Homebrew locations before falling back to a shell-resolved name.
  const magickPath = ['/opt/homebrew/bin/magick', '/usr/local/bin/magick', 'magick']
    .find((candidate) => candidate === 'magick' || fs.existsSync(candidate));
  return new Promise((resolve, reject) => {
    execFile(magickPath, buildMogrifyArgs(inputPath, outputDirectory, resize, quality), (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// Process a dropped/pasted image into a full image and thumbnail, then return
// the configured image shortcode to insert at the cursor.
ipcMain.handle('process-image', async (event, { sourcePath }) => {
  if (typeof sourcePath !== 'string' || !sourcePath) {
    return { ok: false, error: 'Could not read the dropped image path.' };
  }
  const cfg = loadConfig();

  if (!currentFilePath) {
    return { ok: false, error: 'Save your Markdown file first, so images have a folder to live next to.' };
  }

  const postDir = path.dirname(currentFilePath);
  const imagesDir = path.join(postDir, cfg.imagesSubdir);
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const safeName = baseName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  const extension = path.extname(sourcePath) || '.image';

  if (isGifPath(sourcePath)) {
    const gifName = `${safeName}.gif`;
    const destinationPath = path.join(imagesDir, gifName);
    try {
      if (path.resolve(sourcePath) !== path.resolve(destinationPath)) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
      const src = path.posix.join(cfg.imagesSubdir, gifName);
      return {
        ok: true,
        tag: buildImageShortcode(
          cfg.imageShortcodeTemplate || DEFAULT_CONFIG.imageShortcodeTemplate,
          { src, thumb: src, alt: '' }
        )
      };
    } catch (error) {
      return { ok: false, error: `GIF could not be copied: ${error.message}` };
    }
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'almost-editor-image-'));
  const fullInput = path.join(tempDirectory, `${safeName}${extension}`);
  const thumbInput = path.join(tempDirectory, `${safeName}_thumb${extension}`);

  try {
    // mogrify uses its input filename for the output filename. Stage two copies
    // with the desired names so it produces image.jpg and image_thumb.jpg.
    fs.copyFileSync(sourcePath, fullInput);
    fs.copyFileSync(sourcePath, thumbInput);
    await mogrifyImage(fullInput, imagesDir, cfg.imageResize, cfg.imageQuality);
    await mogrifyImage(thumbInput, imagesDir, cfg.thumbnailResize, cfg.thumbnailQuality);
    const src = path.posix.join(cfg.imagesSubdir, `${safeName}.jpg`);
    const thumb = path.posix.join(cfg.imagesSubdir, `${safeName}_thumb.jpg`);
    return {
      ok: true,
      tag: buildImageShortcode(
        cfg.imageShortcodeTemplate || DEFAULT_CONFIG.imageShortcodeTemplate,
        { src, thumb, alt: '' }
      )
    };
  } catch (error) {
    return { ok: false, error: `ImageMagick mogrify failed: ${error.message}. Is ImageMagick installed? (brew install imagemagick)` };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

app.whenReady().then(() => {
  if (!fs.existsSync(CONFIG_PATH)) saveConfig(DEFAULT_CONFIG);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
