import { createMarkdownEditor } from './editor.bundle.js';

const editorHost = document.getElementById('editor');
const preview = document.getElementById('preview');
const panes = document.getElementById('panes');
const toggleBtn = document.getElementById('toggle-preview');
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');
const themeSelect = document.getElementById('theme-select');
const openProjectBtn = document.getElementById('open-project');
const newPostBtn = document.getElementById('new-post');
const projectNameEl = document.getElementById('project-name');
const postListEl = document.getElementById('post-list');
const workspaceEl = document.getElementById('workspace');
const sidebarEl = document.getElementById('post-sidebar');
const sidebarResizer = document.getElementById('sidebar-resizer');
const previewResizer = document.getElementById('preview-resizer');
const newPostDialog = document.getElementById('new-post-dialog');
const newPostForm = document.getElementById('new-post-form');
const newPostName = document.getElementById('new-post-name');
const newPostError = document.getElementById('new-post-error');
const cancelNewPostBtn = document.getElementById('cancel-new-post');
const lightboxEl = document.getElementById('preview-lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const closeLightboxBtn = document.getElementById('close-lightbox');

let currentFilePath = null;
let previewVisible = true;
let renderDebounce = null;
let savedConfig = { theme: 'system' };
let hugoProjectPath = null;
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const editor = createMarkdownEditor(editorHost, handleEditorChange);

function resolvedTheme(choice = savedConfig.theme) {
  return choice === 'system' ? (systemTheme.matches ? 'dark' : 'light') : choice;
}

function applyTheme(choice = savedConfig.theme) {
  document.documentElement.dataset.theme = resolvedTheme(choice);
  editor.setTheme(resolvedTheme(choice));
}

async function initializeTheme() {
  if (window.api) {
    try {
      savedConfig = await window.api.getConfig();
    } catch (error) {
      console.error('Unable to load theme preference:', error);
    }
  }
  themeSelect.value = savedConfig.theme || 'system';
  applyTheme(themeSelect.value);
}

themeSelect.addEventListener('change', async () => {
  savedConfig = { ...savedConfig, theme: themeSelect.value };
  applyTheme();
  if (window.api) {
    try {
      savedConfig = await window.api.saveConfig(savedConfig);
    } catch (error) {
      setStatus('Theme preference could not be saved', true);
      console.error('Unable to save theme preference:', error);
    }
  }
});

systemTheme.addEventListener('change', () => {
  if (savedConfig.theme === 'system') applyTheme();
});

function withoutHugoFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n\1[ \t]*(?:\r?\n|$)/);
  return match ? source.slice(match[0].length) : source;
}

function titleFromFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)[ \t]*\r?\n([\s\S]*?)\r?\n\1[ \t]*(?:\r?\n|$)/);
  if (!match) return '';

  const title = match[2].match(/^\s*title\s*(?::|=)\s*(.+?)\s*$/mi);
  if (!title) return '';
  return title[1].replace(/\s+#.*$/, '').replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, '$1$2').trim();
}

function updateHeader() {
  const filename = currentFilePath ? currentFilePath.split('/').pop() : 'Untitled.md';
  const title = titleFromFrontMatter(editor.getValue());
  filenameEl.textContent = title ? `${filename} · ${title}` : filename;
}

function handleEditorChange() {
  updateHeader();
  scheduleRender();
}

function setupHorizontalResizer(handle, getStartWidth, resize) {
  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = getStartWidth();
    document.body.classList.add('is-resizing');
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent) => resize(moveEvent.clientX - startX, startWidth);
    const stop = () => {
      document.body.classList.remove('is-resizing');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
}

setupHorizontalResizer(sidebarResizer, () => sidebarEl.getBoundingClientRect().width, (delta, startWidth) => {
  const maxWidth = Math.min(480, window.innerWidth * 0.45);
  const width = Math.max(160, Math.min(maxWidth, startWidth + delta));
  sidebarEl.style.width = `${width}px`;
  sidebarEl.style.flexBasis = `${width}px`;
});

setupHorizontalResizer(previewResizer, () => editorHost.getBoundingClientRect().width, (delta, startWidth) => {
  const usableWidth = panes.getBoundingClientRect().width - previewResizer.getBoundingClientRect().width;
  const editorWidth = Math.max(240, Math.min(usableWidth - 240, startWidth + delta));
  editorHost.style.flex = `0 0 ${editorWidth}px`;
  preview.style.flex = '1 1 0';
});

function balanceEditorAndPreview() {
  editorHost.style.flex = '1 1 50%';
  preview.style.flex = '1 1 50%';
}

function closeProjectSidebar() {
  hugoProjectPath = null;
  workspaceEl.classList.add('project-closed');
}

function renderPostList(posts) {
  postListEl.replaceChildren();
  if (!posts.length) {
    const empty = document.createElement('div');
    empty.className = 'post-list-empty';
    empty.textContent = 'No post bundles with index.md found.';
    postListEl.append(empty);
    return;
  }

  for (const post of posts) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'post-entry';
    button.textContent = post.name;
    button.dataset.postPath = post.relativePath;
    postListEl.append(button);
  }
}

function highlightCurrentPost() {
  postListEl.querySelectorAll('.post-entry').forEach((button) => {
    const expectedEnding = `/content/posts/${button.dataset.postPath}/index.md`;
    button.classList.toggle('active', Boolean(currentFilePath && currentFilePath.endsWith(expectedEnding)));
  });
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[character]));
}

function parseShortcodeAttributes(source) {
  const attributes = {};
  const pattern = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

function expandLightboxShortcodes(markdown) {
  const replacements = [];
  const expanded = markdown.replace(/\{\{<\s*lightbox\b([^\n]*?)>\}\}/gi, (shortcode, attributeText) => {
    const attributes = parseShortcodeAttributes(attributeText);
    if (!attributes.src) return shortcode;

    const src = escapeHtml(attributes.src);
    const thumb = escapeHtml(attributes.thumb || attributes.src);
    const alt = escapeHtml(attributes.alt || 'Image');
    const figure = `<figure class="lightbox"><a href="${src}" data-editor-lightbox><img src="${thumb}" alt="${alt}" loading="lazy"></a>${attributes.alt ? `<figcaption>${alt}</figcaption>` : ''}</figure>`;
    const placeholder = `@@EDITOR_LIGHTBOX_${replacements.length}@@`;
    replacements.push({ placeholder, figure });
    return placeholder;
  });

  // Hugo's Goldmark renderer treats an ordinary source newline as whitespace,
  // not as an HTML <br>. This keeps URLs and other inline Markdown together.
  let html = window.marked.parse(expanded, { breaks: false });
  for (const { placeholder, figure } of replacements) {
    html = html.replace(`<p>${placeholder}</p>\n`, figure);
    html = html.replace(placeholder, figure);
  }
  return html;
}

function localPreviewUrl(source) {
  if (!source || /^(https?:|file:|data:|#)/i.test(source) || !currentFilePath) return source;
  const postDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
  return new URL(source, `file://${postDir}/`).href;
}

function renderPreview() {
  try {
    if (!window.marked) throw new Error('Markdown parser failed to load');
    // Hugo removes front matter before rendering a page. Do the same for the
    // editor preview, then render with Marked's browser bundle.
    preview.innerHTML = expandLightboxShortcodes(withoutHugoFrontMatter(editor.getValue()));
  } catch (error) {
    console.error('Unable to render Markdown preview:', error);
    preview.textContent = `Preview error: ${error.message}`;
    setStatus('Preview could not be rendered', true);
    return;
  }

  // Markdown image paths are relative to the post's folder (e.g. "images/foo.webp"),
  // but the preview pane is loaded from renderer/index.html, so rewrite them to
  // absolute file:// URLs based on where the .md file lives.
  if (currentFilePath) {
    const postDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
    preview.querySelectorAll('img, a[href]').forEach((element) => {
      const attribute = element.tagName === 'IMG' ? 'src' : 'href';
      const source = element.getAttribute(attribute);
      if (source) element.setAttribute(attribute, localPreviewUrl(source));
    });
  }
}

// Debounce so we're not re-rendering on every single keystroke in a long post
function scheduleRender() {
  clearTimeout(renderDebounce);
  renderDebounce = setTimeout(renderPreview, 150);
}

toggleBtn.addEventListener('click', () => {
  previewVisible = !previewVisible;
  preview.classList.toggle('hidden', !previewVisible);
  previewResizer.classList.toggle('hidden', !previewVisible);
  panes.classList.toggle('preview-hidden', !previewVisible);
  toggleBtn.textContent = previewVisible ? 'Hide Preview' : 'Show Preview';
});

preview.addEventListener('click', (event) => {
  const link = event.target.closest('a[data-editor-lightbox]');
  if (!link) return;
  event.preventDefault();
  const image = link.querySelector('img');
  lightboxImage.src = link.href;
  lightboxImage.alt = image ? image.alt : 'Image';
  lightboxEl.classList.remove('hidden');
  closeLightboxBtn.focus();
});

function closeLightbox() {
  lightboxEl.classList.add('hidden');
  lightboxImage.removeAttribute('src');
}

closeLightboxBtn.addEventListener('click', closeLightbox);
lightboxEl.addEventListener('click', (event) => {
  if (event.target === lightboxEl) closeLightbox();
});

openProjectBtn.addEventListener('click', async () => {
  if (!window.api) return;
  await window.api.openHugoProjectDialog();
});

newPostBtn.addEventListener('click', async () => {
  if (!hugoProjectPath || !window.api) {
    setStatus('Open a Hugo project before creating a post', true);
    return;
  }
  newPostError.textContent = '';
  newPostName.value = '';
  newPostDialog.classList.remove('hidden');
  newPostName.focus();
});

function closeNewPostDialog() {
  newPostDialog.classList.add('hidden');
}

cancelNewPostBtn.addEventListener('click', closeNewPostDialog);
newPostDialog.addEventListener('click', (event) => {
  if (event.target === newPostDialog) closeNewPostDialog();
});

newPostForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = newPostName.value.trim();
  if (!name) return;
  const result = await window.api.createHugoPost({ projectPath: hugoProjectPath, name });
  if (result.ok) {
    closeNewPostDialog();
    return;
  }
  newPostError.textContent = result.error || 'Could not create post';
});

postListEl.addEventListener('click', async (event) => {
  const button = event.target.closest('.post-entry');
  if (!button || !window.api || !hugoProjectPath) return;
  // Opening the first selected post starts the writing/preview panes evenly.
  // Once a post is selected, preserve any split width the user has chosen.
  if (!postListEl.querySelector('.post-entry.active')) balanceEditorAndPreview();
  const result = await window.api.openHugoPost({
    projectPath: hugoProjectPath,
    relativePath: button.dataset.postPath
  });
  if (!result.ok) setStatus(result.error || 'Could not open post', true);
});

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#e06c75' : 'var(--success)';
  if (msg) setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

function insertAtCursor(text) {
  editor.insertAtCursor(text);
}

async function handleImageFile(filePath) {
  if (!window.api) {
    setStatus('Image processing is unavailable because the Electron API did not load', true);
    return;
  }
  const alt = window.prompt('Alt text for this image (used in the tag):', '');
  setStatus('Converting image…');
  const result = await window.api.processImage({ sourcePath: filePath, alt: alt || '' });
  if (!result.ok) {
    setStatus(result.error, true);
    window.alert(result.error);
    return;
  }
  insertAtCursor('\n' + result.tag + '\n');
  setStatus('Image inserted');
  renderPreview();
}

// --- Drag & drop ---
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files);
  const imageFile = files.find(f => /\.(png|jpe?g|gif|heic|tiff?|bmp|webp)$/i.test(f.name));
  if (imageFile) {
    // Electron's File objects expose a real filesystem path
    handleImageFile(imageFile.path);
  }
});

// --- Paste (e.g. screenshot from clipboard is handled via drag/drop of a temp file;
// pasting a file path also works if the clipboard contains one) ---
editor.onPaste((e) => {
  const items = Array.from(e.clipboardData.items || []);
  const fileItem = items.find(i => i.kind === 'file');
  if (fileItem) {
    const file = fileItem.getAsFile();
    if (file && file.path) {
      e.preventDefault();
      handleImageFile(file.path);
    }
  }
});

// --- File open/save wiring ---
if (window.api) {
  window.api.onFileOpened(({ filePath, content, projectPath }) => {
    currentFilePath = filePath;
    if (projectPath) {
      hugoProjectPath = projectPath;
      workspaceEl.classList.remove('project-closed');
    } else {
      closeProjectSidebar();
    }
    editor.setValue(content);
    updateHeader();
    highlightCurrentPost();
    renderPreview();
  });

  window.api.onProjectOpened(({ projectPath, posts }) => {
    hugoProjectPath = projectPath;
    workspaceEl.classList.remove('project-closed');
    projectNameEl.textContent = projectPath.split('/').pop();
    projectNameEl.title = projectPath;
    renderPostList(posts);
    highlightCurrentPost();
    setStatus(`${posts.length} Hugo posts loaded`);
  });

  window.api.onRequestSave(() => saveCurrent(false));
  window.api.onRequestSaveAs(() => saveCurrent(true));
} else {
  console.error('Electron preload API was not loaded');
  setStatus('File actions unavailable: Electron preload API did not load', true);
}

async function saveCurrent(forcePicker) {
  if (!window.api) {
    setStatus('Saving is unavailable because the Electron API did not load', true);
    return;
  }
  const result = await window.api.saveFile({
    content: editor.getValue(),
    filePath: forcePicker ? null : currentFilePath
  });
  if (result.ok) {
    currentFilePath = result.filePath;
    updateHeader();
    setStatus('Saved');
    renderPreview(); // Resolve shortcode image paths once this post has a folder.
  }
}

// Render once after the DOM and preload bridge are both ready. Without this,
// the preview remains stale until an input or file-open event happens.
initializeTheme();
balanceEditorAndPreview();
renderPreview();

// Cmd+S shortcut inside the editor itself too
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !newPostDialog.classList.contains('hidden')) {
    closeNewPostDialog();
    return;
  }
  if (e.key === 'Escape' && !lightboxEl.classList.contains('hidden')) {
    closeLightbox();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveCurrent(e.shiftKey);
  }
});
