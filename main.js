const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
const { atomicWrite, readText, readRecovery, validDraft } = require('./lib/file-storage');
const authorizedFiles = new Map();
const authorizedProjects = new Set();
function authorizeFile(filePath) {
  authorizedFiles.set(filePath, fs.realpathSync(filePath));
}
function validFile(filePath) {
  try {
    return authorizedFiles.has(filePath) && fs.realpathSync(filePath) === authorizedFiles.get(filePath);
  } catch {
    return false;
  }
}
const { execFile } = require('child_process');
const {
  createHugoFrontMatter,
  isValidPostName,
  listHugoPosts,
  resolveHugoPostDirectory,
  resolveHugoPostPath
} = require('./lib/hugo-project');
const { buildImageShortcode, buildMogrifyArgs, isGifPath, reserveImagePaths } = require('./lib/image-processing');
const { normalizeWindowState } = require('./lib/window-state');

app.setName('Almost Editor');

let mainWindow;
let currentFilePath = null; // path of the .md file currently open
let allowWindowClose = false;
let isQuitting = false;
let closePending = false;

const RECOVERY_PATH = path.join(app.getPath('userData'), 'draft-recovery.json');
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
  syncScroll: false,
  recentDocuments: [],
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
  atomicWrite(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}

function createWindow() {
  allowWindowClose = false;
  closePending = false;
  authorizedFiles.clear();
  authorizedProjects.clear();
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
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  updateApplicationMenu([]);

  mainWindow.on('close', (event) => {
    if (allowWindowClose) {
      persistWindowState();
      return;
    }
    event.preventDefault();
    closePending = true;
    mainWindow.webContents.send('request-window-close');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    currentFilePath = null;
  });
}

function updateApplicationMenu(documents) {
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => newFile() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => openFile() },
        { label: 'Open Hugo Project…', accelerator: 'CmdOrCtrl+Shift+O', click: () => openHugoProject() },
        { label: 'Open Documents', id: 'open-documents', submenu: documents.length
          ? documents.map(document => ({
            id: `document:${document.key}`, label: document.label, type: 'checkbox', checked: document.active,
            click: () => { if (!closePending) mainWindow.webContents.send('activate-document', document.key); }
          }))
          : [{ label: 'No open documents', enabled: false }] },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('request-save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => mainWindow.webContents.send('request-save-as') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(process.platform === 'darwin' ? [{ role: 'pasteAndMatchStyle' }] : []),
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          submenu: [
            { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('request-find') },
            {
              label: 'Find Next',
              accelerator: process.platform === 'darwin' ? 'Cmd+G' : 'F3',
              click: () => mainWindow.webContents.send('request-find-next')
            },
            {
              label: 'Find Previous',
              accelerator: process.platform === 'darwin' ? 'Cmd+Shift+G' : 'Shift+F3',
              click: () => mainWindow.webContents.send('request-find-previous')
            }
          ]
        }
      ]
    },
    { role: 'windowMenu' }
  ]);
  Menu.setApplicationMenu(menu);
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
  if (closePending) return { ok: false };
  currentFilePath = null;
  mainWindow.webContents.send('file-opened', { filePath: null, content: '', projectPath: null });
}

function openFile() {
  if (closePending) return { ok: false };
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
  authorizeFile(filePath);
  currentFilePath = filePath;
  saveConfig({ ...cfg, lastOpenedDirectory: path.dirname(filePath) });
  rememberDocument(filePath);
  mainWindow.webContents.send('file-opened', { filePath, content, projectPath: null });
}

function sendProjectOpened(projectPath) {
  const posts = listHugoPosts(projectPath);
  authorizedProjects.add(projectPath);
  mainWindow.webContents.send('project-opened', { projectPath, posts });
  return { ok: true, projectPath, posts };
}

function openHugoPost(projectPath, relativePath, remember = true) {
  if (closePending) return { ok: false };
  if (!authorizedProjects.has(projectPath)) return { ok: false, error: 'Open the project first.' };
  const postPath = resolveHugoPostPath(projectPath, relativePath);
  if (!postPath || !fs.existsSync(postPath) || !fs.statSync(postPath).isFile()) {
    return { ok: false, error: 'The selected post could not be found.' };
  }
  const root = fs.realpathSync(path.join(projectPath, 'content', 'posts'));
  if (!fs.realpathSync(postPath).startsWith(root + path.sep)) return { ok: false, error: 'Post is outside content/posts.' };
  const content = fs.readFileSync(postPath, 'utf8');
  authorizeFile(postPath);
  rememberDocument(postPath, projectPath);
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

function isPathInDirectory(filePath, directoryPath) {
  const resolvedFile = path.resolve(filePath);
  const resolvedDirectory = path.resolve(directoryPath);
  return resolvedFile === resolvedDirectory || resolvedFile.startsWith(`${resolvedDirectory}${path.sep}`);
}

function validatedHugoPostDirectory(projectPath, relativePath) {
  const postsRoot = path.resolve(projectPath, 'content', 'posts');
  const postDirectory = resolveHugoPostDirectory(projectPath, relativePath);
  if (!postDirectory || !fs.existsSync(postsRoot) || !fs.statSync(postsRoot).isDirectory()) {
    throw new Error('The selected post directory could not be found.');
  }
  if (!fs.existsSync(postDirectory)) {
    throw new Error('The selected post directory could not be found.');
  }
  const postDirectoryStat = fs.lstatSync(postDirectory);
  if (postDirectoryStat.isSymbolicLink()) {
    throw new Error('Linked post directories cannot be deleted from Almost Editor.');
  }
  if (!postDirectoryStat.isDirectory()) throw new Error('The selected post directory could not be found.');
  const realPostsRoot = fs.realpathSync(postsRoot);
  const realPostDirectory = fs.realpathSync(postDirectory);
  if (!isPathInDirectory(realPostDirectory, realPostsRoot) || realPostDirectory === realPostsRoot) {
    throw new Error('The selected post is outside content/posts.');
  }
  const indexPath = path.join(realPostDirectory, 'index.md');
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    throw new Error('The selected directory is no longer a Hugo post bundle.');
  }
  return postDirectory;
}

async function confirmAndDeleteHugoPost(projectPath, relativePath, hasUnsavedChanges) {
  try {
    let postDirectory = validatedHugoPostDirectory(projectPath, relativePath);
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Delete Blog Post',
      message: `Delete “${relativePath}”?`,
      detail: `${hasUnsavedChanges ? 'This post has unsaved changes. ' : ''}This permanently deletes the post directory and every file inside it. This cannot be undone.`
    });
    if (result.response !== 1 || !mainWindow || mainWindow.isDestroyed()) return;

    // Revalidate after the confirmation window in case the directory changed
    // while it was open.
    postDirectory = validatedHugoPostDirectory(projectPath, relativePath);
    fs.rmSync(postDirectory, { recursive: true });

    for (const filePath of authorizedFiles.keys()) {
      if (isPathInDirectory(filePath, postDirectory)) authorizedFiles.delete(filePath);
    }
    const deletedCurrentPost = Boolean(currentFilePath && isPathInDirectory(currentFilePath, postDirectory));
    if (deletedCurrentPost) currentFilePath = null;

    const cfg = loadConfig();
    const lastPostDirectory = cfg.lastHugoProject === projectPath && cfg.lastHugoPost
      ? resolveHugoPostDirectory(projectPath, cfg.lastHugoPost) : null;
    try {
      saveConfig({
        ...cfg,
        lastOpenedDirectory: typeof cfg.lastOpenedDirectory === 'string' &&
          isPathInDirectory(cfg.lastOpenedDirectory, postDirectory)
          ? path.join(projectPath, 'content', 'posts') : cfg.lastOpenedDirectory,
        lastHugoPost: lastPostDirectory && isPathInDirectory(lastPostDirectory, postDirectory)
          ? null : cfg.lastHugoPost
      });
    } catch (error) {
      // The post is already deleted; a preference write must not prevent the
      // renderer from reflecting that successful filesystem change.
      console.error('Could not update preferences after deleting a post:', error);
    }

    const posts = listHugoPosts(projectPath);
    mainWindow.webContents.send('hugo-post-deleted', {
      projectPath,
      relativePath,
      postDirectory,
      posts,
      deletedCurrentPost
    });
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Could not delete blog post', error.message);
    }
  }
}

function restoreLastSession() {
  const { lastHugoProject, lastHugoPost } = loadConfig();
  try {
    if (lastHugoProject && fs.existsSync(lastHugoProject)) {
      sendProjectOpened(lastHugoProject);
      if (lastHugoPost) openHugoPost(lastHugoProject, lastHugoPost, false);
    }
  } catch (error) {
    console.error('Failed to restore Hugo project:', error);
  }
  try {
    const snapshot = readRecovery(RECOVERY_PATH);
    for (const draft of snapshot.documents) {
      if (draft.filePath) {
        if (fs.existsSync(draft.filePath)) authorizeFile(draft.filePath);
        else authorizedFiles.set(draft.filePath, path.resolve(draft.filePath));
      }
      if (draft.projectPath && fs.existsSync(path.join(draft.projectPath, 'content', 'posts'))) {
        authorizedProjects.add(draft.projectPath);
      }
    }
    mainWindow.webContents.send('drafts-recovered', snapshot);
  } catch (error) {
    // Keep the unreadable recovery file for manual recovery instead of replacing it.
    mainWindow.webContents.send('drafts-recovered', { documents: [], error: error.message });
  }
}

function openHugoProject() {
  if (closePending) return { ok: false };
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
function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents ||
        event.senderFrame !== mainWindow.webContents.mainFrame ||
        event.senderFrame.url !== pathToFileURL(path.join(__dirname, 'renderer', 'index.html')).href) {
      throw new Error('Untrusted IPC sender');
    }
    return callback(event, ...args);
  });
}

handle('open-external', async (event, url) => {
  if (typeof url !== 'string') return { ok: false };
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return { ok: false };
    await shell.openExternal(parsed.href);
    return { ok: true };
  } catch { return { ok: false }; }
});

handle('get-config', () => ({ config: loadConfig(), defaults: DEFAULT_CONFIG }));

handle('save-config', (event, cfg) => {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return loadConfig();
  const { recentDocuments: ignoredRecents, ...preferences } = cfg;
  saveConfig({ ...loadConfig(), ...preferences });
  return loadConfig();
});

function rememberDocument(filePath, projectPath = null) {
  const cfg = loadConfig();
  const entries = Array.isArray(cfg.recentDocuments) ? cfg.recentDocuments : [];
  saveConfig({ ...cfg, recentDocuments: [{ filePath, projectPath }, ...entries.filter(item => item.filePath !== filePath)].slice(0, 8) });
}

handle('get-recent-documents', async () => {
  const { titleFromFrontMatter } = await import('./renderer/markdown-tools.mjs');
  return loadConfig().recentDocuments.map(entry => {
    try { return { ...entry, title: titleFromFrontMatter(fs.readFileSync(entry.filePath, 'utf8')) }; }
    catch { return entry; }
  });
});
handle('clear-recent-documents', () => { saveConfig({ ...loadConfig(), recentDocuments: [] }); return { ok: true }; });
handle('new-file', () => newFile());
handle('choose-image', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'heic', 'tif', 'tiff', 'bmp', 'webp'] }] });
  return result.canceled ? null : result.filePaths[0];
});
handle('open-recent', (event, filePath) => {
  if (closePending || typeof filePath !== 'string') return { ok: false };
  const entry = loadConfig().recentDocuments.find(item => item.filePath === filePath);
  if (!entry) return { ok: false, error: 'Document is no longer in recent files.' };
  try {
    if (entry.projectPath) {
      sendProjectOpened(entry.projectPath);
      return openHugoPost(entry.projectPath, path.relative(path.join(entry.projectPath, 'content/posts'), path.dirname(filePath)));
    }
    const content = fs.readFileSync(filePath, 'utf8');
    authorizeFile(filePath);
    currentFilePath = filePath;
    rememberDocument(filePath);
    mainWindow.webContents.send('file-opened', { filePath, content, projectPath: null });
    return { ok: true };
  } catch (error) { return { ok: false, error: `Could not open document: ${error.message}` }; }
});

handle('open-file-dialog', () => {
  openFile();
  return null;
});

handle('open-hugo-project-dialog', () => openHugoProject());

handle('open-hugo-post', (event, { projectPath, relativePath }) => (
  openHugoPost(projectPath, relativePath)
));

handle('create-hugo-post', (event, { projectPath, name, title }) => {
  if (closePending) return { ok: false };
  if (!authorizedProjects.has(projectPath) || typeof name !== 'string') return { ok: false, error: 'Invalid project or name.' };
  if (title !== undefined && (typeof title !== 'string' || !title.trim())) return { ok: false, error: 'Enter a post title.' };
  const postName = name.trim();
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
  const frontMatter = createHugoFrontMatter(title?.trim() || postName, date);

  try {
    fs.mkdirSync(path.join(postDirectory, 'images'), { recursive: true });
    const indexPath = path.join(postDirectory, 'index.md');
    fs.writeFileSync(indexPath, frontMatter, 'utf8');
    authorizeFile(indexPath);
    currentFilePath = indexPath;
    const cfg = loadConfig();
    saveConfig({
      ...cfg,
      lastOpenedDirectory: postDirectory,
      lastHugoProject: projectPath,
      lastHugoPost: postName
    });
    rememberDocument(indexPath, projectPath);
    sendProjectOpened(projectPath);
    mainWindow.webContents.send('file-opened', { filePath: indexPath, content: frontMatter, projectPath });
    return { ok: true, filePath: indexPath };
  } catch (error) {
    return { ok: false, error: `Could not create post: ${error.message}` };
  }
});

handle('show-hugo-post-context-menu', (event, payload) => {
  if (closePending || !payload || typeof payload !== 'object') return { ok: false };
  const { projectPath, relativePath, hasUnsavedChanges = false } = payload;
  if (!authorizedProjects.has(projectPath) || typeof relativePath !== 'string' ||
      typeof hasUnsavedChanges !== 'boolean') {
    return { ok: false, error: 'Invalid project or post.' };
  }
  try {
    validatedHugoPostDirectory(projectPath, relativePath);
    const menu = Menu.buildFromTemplate([{
      label: 'Delete Post…',
      click: () => { void confirmAndDeleteHugoPost(projectPath, relativePath, hasUnsavedChanges); }
    }]);
    menu.popup({ window: mainWindow });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

handle('update-document-menu', (event, documents) => {
  if (!Array.isArray(documents) || !documents.every(document => document &&
      typeof document.key === 'string' && typeof document.label === 'string' &&
      typeof document.active === 'boolean')) return { ok: false };
  updateApplicationMenu(documents);
  return { ok: true };
});

handle('set-active-file', (event, { filePath, projectPath = null }) => {
  if (filePath !== null && !authorizedFiles.has(filePath)) return { ok: false };
  currentFilePath = filePath;
  if (projectPath && authorizedProjects.has(projectPath)) sendProjectOpened(projectPath);
  return { ok: true };
});

handle('save-recovery', (event, snapshot) => {
  if (!snapshot || !Array.isArray(snapshot.documents) || !snapshot.documents.every(validDraft)) {
    return { ok: false, error: 'Invalid recovery snapshot.' };
  }
  try {
    atomicWrite(RECOVERY_PATH, JSON.stringify(snapshot));
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
});

handle('save-file', (event, { content, filePath, expectedContent, forcePicker = false, protectedPaths = [] }) => {
  if (typeof content !== 'string' || typeof expectedContent !== 'string' ||
      (filePath !== null && typeof filePath !== 'string') ||
      !Array.isArray(protectedPaths) || !protectedPaths.every(p => typeof p === 'string')) {
    return { ok: false, error: 'Invalid file payload.' };
  }
  let targetPath = forcePicker ? null : filePath;
  if (targetPath && !authorizedFiles.has(targetPath)) return { ok: false, error: 'Open the file before saving it.' };
  try {
    const chooseCopy = () => dialog.showSaveDialogSync(mainWindow, {
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: filePath ? path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}-copy.md`)
        : loadConfig().lastOpenedDirectory || undefined
    });
    if (!targetPath) targetPath = chooseCopy();
    if (!targetPath) return { ok: false };
    const canonical = p => fs.existsSync(p) ? fs.realpathSync(p) : path.resolve(p);
    const writeTarget = () => {
      const resolved = canonical(targetPath);
      if (protectedPaths.some(p => canonical(p) === resolved)) {
        throw new Error('Another open draft uses this destination. Choose a different filename.');
      }
      const isOriginal = filePath && (targetPath === filePath || resolved === authorizedFiles.get(filePath));
      if (isOriginal && (!validFile(filePath) || readText(resolved) !== expectedContent)) {
        const error = new Error('The file changed or was deleted on disk.');
        error.code = 'CONFLICT';
        throw error;
      }
      atomicWrite(resolved, content, { expectedContent: isOriginal ? expectedContent : readText(resolved) });
      authorizeFile(targetPath);
    };
    try { writeTarget(); }
    catch (error) {
      if (error.code !== 'CONFLICT') throw error;
      const response = dialog.showMessageBoxSync(mainWindow, {
        type: 'warning', buttons: ['Save a Copy…', 'Cancel'], defaultId: 0, cancelId: 1,
        message: 'This file changed on disk.',
        detail: 'Your draft has been kept. Save a copy to preserve both versions.'
      });
      if (response !== 0) return { ok: false, conflict: true, error: 'Save cancelled; your draft is still unsaved.' };
      targetPath = chooseCopy();
      if (!targetPath) return { ok: false };
      writeTarget();
    }
    const cfg = loadConfig();
    // A preferences write failure must not misreport a successful document save.
    try {
      saveConfig({ ...cfg, lastOpenedDirectory: path.dirname(targetPath) });
      rememberDocument(targetPath, cfg.recentDocuments.find(item => item.filePath === targetPath)?.projectPath);
    }
    catch (error) { console.error('Could not remember save directory:', error); }
    return { ok: true, filePath: targetPath };
  } catch (error) { return { ok: false, error: error.message }; }
});

handle('confirm-window-close', async (event, { dirtyCount }) => {
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

handle('finish-window-close', (event, { close, discardRecovery = false }) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return { ok: false };
  if (!close) {
    closePending = false;
    isQuitting = false;
    return { ok: true };
  }
  if (discardRecovery) atomicWrite(RECOVERY_PATH, JSON.stringify({ documents: [], activeKey: null }));
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
handle('process-image', async (event, { sourcePath, alt = '', filePath = currentFilePath }) => {
  if (typeof alt !== 'string' || alt.length > 2000) return { ok: false, error: 'Invalid alternative text.' };
  alt = alt.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\r\n]/g, ' ');
  if (typeof sourcePath !== 'string' || !sourcePath) {
    return { ok: false, error: 'Could not read the dropped image path.' };
  }
  const cfg = loadConfig();

  if (typeof filePath !== 'string' || !validFile(filePath)) {
    return { ok: false, error: 'Save your Markdown file first, so images have a folder to live next to.' };
  }

  const postDir = path.dirname(filePath);
  if (typeof cfg.imagesSubdir !== 'string' || path.isAbsolute(cfg.imagesSubdir) || cfg.imagesSubdir.split(/[\\/]/).includes('..')) return { ok: false, error: 'Invalid image directory.' };
  const imagesDir = path.join(postDir, cfg.imagesSubdir);
  if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

  if (!fs.realpathSync(imagesDir).startsWith(fs.realpathSync(postDir) + path.sep)) return { ok: false, error: 'Image directory must be inside the post.' };

  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const safeName = baseName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  const extension = path.extname(sourcePath) || '.image';

  if (isGifPath(sourcePath)) {
    const [destinationPath] = reserveImagePaths(imagesDir, safeName, true);
    const gifName = path.basename(destinationPath);
    try {
      if (path.resolve(sourcePath) !== path.resolve(destinationPath)) {
        fs.copyFileSync(sourcePath, destinationPath);
      }
      const src = path.posix.join(cfg.imagesSubdir, gifName);
      return {
        ok: true,
        tag: buildImageShortcode(
          cfg.imageShortcodeTemplate || DEFAULT_CONFIG.imageShortcodeTemplate,
          { src, thumb: src, alt }
        )
      };
    } catch (error) {
      fs.rmSync(destinationPath, { force: true });
      return { ok: false, error: `GIF could not be copied: ${error.message}` };
    }
  }

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'almost-editor-image-'));
  const fullInput = path.join(tempDirectory, `${safeName}${extension}`);
  const thumbInput = path.join(tempDirectory, `${safeName}_thumb${extension}`);

  let outputs = [];
  let completed = false;
  try {
    // mogrify uses its input filename for the output filename. Stage two copies
    // with the desired names so it produces image.jpg and image_thumb.jpg.
    fs.copyFileSync(sourcePath, fullInput);
    fs.copyFileSync(sourcePath, thumbInput);
    const convertedDir = path.join(tempDirectory, 'converted');
    fs.mkdirSync(convertedDir);
    await mogrifyImage(fullInput, convertedDir, cfg.imageResize, cfg.imageQuality);
    await mogrifyImage(thumbInput, convertedDir, cfg.thumbnailResize, cfg.thumbnailQuality);
    outputs = reserveImagePaths(imagesDir, safeName, false);
    fs.copyFileSync(path.join(convertedDir, `${safeName}.jpg`), outputs[0]);
    fs.copyFileSync(path.join(convertedDir, `${safeName}_thumb.jpg`), outputs[1]);
    completed = true;
    const src = path.posix.join(cfg.imagesSubdir, path.basename(outputs[0]));
    const thumb = path.posix.join(cfg.imagesSubdir, path.basename(outputs[1]));
    return {
      ok: true,
      tag: buildImageShortcode(
        cfg.imageShortcodeTemplate || DEFAULT_CONFIG.imageShortcodeTemplate,
        { src, thumb, alt }
      )
    };
  } catch (error) {
    return { ok: false, error: `ImageMagick mogrify failed: ${error.message}. Is ImageMagick installed? (brew install imagemagick)` };
  } finally {
    if (!completed) outputs.forEach((output) => fs.rmSync(output, { force: true }));
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
