const { app, BrowserWindow, Menu, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

app.setName('Almost Editor');

let mainWindow;
let currentFilePath = null; // path of the .md file currently open

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  // Where processed images get saved, relative to the folder the .md file lives in
  imagesSubdir: 'images',
  imageResize: '1500x1500',
  imageQuality: 70,
  thumbnailResize: '500x500',
  thumbnailQuality: 60,
  theme: 'system',
  fontSize: 15,
  lastOpenedDirectory: null,
  lastHugoProject: null
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
        { label: 'Open Hugo Project…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openHugoProject() },
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

function listHugoPosts(projectPath) {
  const postsRoot = path.join(projectPath, 'content', 'posts');
  if (!fs.existsSync(postsRoot) || !fs.statSync(postsRoot).isDirectory()) {
    throw new Error('This folder does not contain content/posts. Select your Hugo project root.');
  }

  const posts = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      const indexPath = path.join(fullPath, 'index.md');
      if (fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
        const relativePath = path.relative(postsRoot, fullPath);
        posts.push({ name: relativePath, relativePath });
      }
      walk(fullPath);
    }
  }
  walk(postsRoot);
  return posts.sort((a, b) => a.name.localeCompare(b.name));
}

function sendProjectOpened(projectPath) {
  const posts = listHugoPosts(projectPath);
  mainWindow.webContents.send('project-opened', { projectPath, posts });
  return { ok: true, projectPath, posts };
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
    saveConfig({ ...cfg, lastHugoProject: projectPath });
    return payload;
  } catch (error) {
    dialog.showErrorBox('Cannot open Hugo project', error.message);
    return { ok: false, error: error.message };
  }
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

ipcMain.handle('open-hugo-project-dialog', () => openHugoProject());

ipcMain.handle('open-hugo-post', (event, { projectPath, relativePath }) => {
  const postsRoot = path.resolve(projectPath, 'content', 'posts');
  const postPath = path.resolve(postsRoot, relativePath, 'index.md');
  if (!postPath.startsWith(`${postsRoot}${path.sep}`) || !fs.existsSync(postPath)) {
    return { ok: false, error: 'The selected post could not be found.' };
  }
  const content = fs.readFileSync(postPath, 'utf8');
  currentFilePath = postPath;
  const cfg = loadConfig();
  saveConfig({ ...cfg, lastOpenedDirectory: path.dirname(postPath), lastHugoProject: projectPath });
  mainWindow.webContents.send('file-opened', { filePath: postPath, content, projectPath });
  return { ok: true, filePath: postPath };
});

ipcMain.handle('create-hugo-post', (event, { projectPath, name }) => {
  const postName = String(name || '').trim();
  if (!postName || postName === '.' || postName === '..' || path.basename(postName) !== postName) {
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
  const frontMatter = [
    '+++',
    'author: ""',
    `title: ${JSON.stringify(postName)}`,
    `date: "${date}"`,
    'description: ""',
    'tags: []',
    '+++',
    ''
  ].join('\n');

  try {
    fs.mkdirSync(path.join(postDirectory, 'images'), { recursive: true });
    const indexPath = path.join(postDirectory, 'index.md');
    fs.writeFileSync(indexPath, frontMatter, 'utf8');
    currentFilePath = indexPath;
    const cfg = loadConfig();
    saveConfig({ ...cfg, lastOpenedDirectory: postDirectory, lastHugoProject: projectPath });
    sendProjectOpened(projectPath);
    mainWindow.webContents.send('file-opened', { filePath: indexPath, content: frontMatter, projectPath });
    return { ok: true, filePath: indexPath };
  } catch (error) {
    return { ok: false, error: `Could not create post: ${error.message}` };
  }
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

function mogrifyImage(inputPath, outputDirectory, resize, quality) {
  return new Promise((resolve, reject) => {
    execFile('magick', ['mogrify', '-path', outputDirectory, '-format', 'jpg', '-resize', resize, '-quality', String(quality), inputPath], (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// Process a dropped/pasted image into a full image and thumbnail, then return
// the Hugo lightbox shortcode to insert at the cursor.
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
    return { ok: true, tag: `{{< lightbox src="${src}" thumb="${thumb}" alt="" >}}` };
  } catch (error) {
    return { ok: false, error: `ImageMagick mogrify failed: ${error.message}. Is ImageMagick installed? (brew install imagemagick)` };
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

app.whenReady().then(() => {
  if (!fs.existsSync(CONFIG_PATH)) saveConfig(DEFAULT_CONFIG);
  createWindow();
  mainWindow.webContents.once('did-finish-load', () => {
    const { lastHugoProject } = loadConfig();
    if (!lastHugoProject || !fs.existsSync(lastHugoProject)) return;
    try {
      sendProjectOpened(lastHugoProject);
    } catch (error) {
      console.error('Failed to restore Hugo project:', error);
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
