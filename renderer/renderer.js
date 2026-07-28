import { createMarkdownEditor } from './editor.bundle.js';

const editorHost = document.getElementById('editor');
const preview = document.getElementById('preview');
const panes = document.getElementById('panes');
const toggleBtn = document.getElementById('toggle-preview');
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');
const themeSelect = document.getElementById('theme-select');
const fontSizeSelect = document.getElementById('font-size-select');
const imageOptionsBtn = document.getElementById('image-options');
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
const imageOptionsDialog = document.getElementById('image-options-dialog');
const imageOptionsForm = document.getElementById('image-options-form');
const imageResizeInput = document.getElementById('image-resize');
const imageQualityInput = document.getElementById('image-quality');
const thumbnailResizeInput = document.getElementById('thumbnail-resize');
const thumbnailQualityInput = document.getElementById('thumbnail-quality');
const imageOptionsError = document.getElementById('image-options-error');
const cancelImageOptionsBtn = document.getElementById('cancel-image-options');
const resetImageOptionsBtn = document.getElementById('reset-image-options');
const lightboxEl = document.getElementById('preview-lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const closeLightboxBtn = document.getElementById('close-lightbox');

let currentFilePath = null;
let previewVisible = true;
let renderDebounce = null;
let savedConfig = { theme: 'system', fontSize: 15 };
let hugoProjectPath = null;
let currentProjectPostName = null;
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
  const fontSize = Number(savedConfig.fontSize) || 15;
  fontSizeSelect.value = String(fontSize);
  editor.setFontSize(fontSize);
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

fontSizeSelect.addEventListener('change', async () => {
  const fontSize = Number(fontSizeSelect.value);
  savedConfig = { ...savedConfig, fontSize };
  editor.setFontSize(fontSize);
  if (window.api) {
    try {
      savedConfig = await window.api.saveConfig(savedConfig);
    } catch (error) {
      setStatus('Text size preference could not be saved', true);
      console.error('Unable to save text size preference:', error);
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
  const title = titleFromFrontMatter(editor.getValue());
  if (currentProjectPostName) {
    filenameEl.textContent = title;
    return;
  }
  const filename = currentFilePath ? currentFilePath.split('/').pop() : 'Untitled.md';
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

function expandHugoRefLinks(markdown) {
  // Marked cannot parse a Hugo shortcode as a Markdown link destination. Keep
  // the link text intact, but use a local scheme that the preview can route to
  // the referenced post bundle.
  return markdown.replace(
    /\[([^\]]+)\]\(\s*\{\{<\s*ref\s+["']([^"']+)["']\s*>\}\}\s*\)/gi,
    (fullMatch, label, target) => `[${label}](hugo-ref:${target})`
  );
}

function localPreviewUrl(source) {
  if (!source || /^(https?:|file:|data:|hugo-ref:|#)/i.test(source) || !currentFilePath) return source;
  const postDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
  return new URL(source, `file://${postDir}/`).href;
}

function renderPreview() {
  try {
    if (!window.marked) throw new Error('Markdown parser failed to load');
    // Hugo removes front matter before rendering a page. Do the same for the
    // editor preview, then render with Marked's browser bundle.
    const markdown = expandHugoRefLinks(withoutHugoFrontMatter(editor.getValue()));
    preview.innerHTML = expandLightboxShortcodes(markdown);
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

function updatePreviewToggleIcon() {
  const eyePath = '<path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Zm9.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/>';
  const slashPath = '<path d="m3 3 18 18"/>';
  toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${eyePath}${previewVisible ? slashPath : ''}</svg>`;
}

toggleBtn.addEventListener('click', () => {
  previewVisible = !previewVisible;
  preview.classList.toggle('hidden', !previewVisible);
  previewResizer.classList.toggle('hidden', !previewVisible);
  panes.classList.toggle('preview-hidden', !previewVisible);
  const label = previewVisible ? 'Hide preview' : 'Show preview';
  toggleBtn.setAttribute('aria-label', label);
  toggleBtn.title = label;
  updatePreviewToggleIcon();
});

preview.addEventListener('click', (event) => {
  const refLink = event.target.closest('a[href^="hugo-ref:"]');
  if (refLink) {
    event.preventDefault();
    if (!window.api || !hugoProjectPath) {
      setStatus('Open this Hugo project to follow post references', true);
      return;
    }
    const target = refLink.getAttribute('href').slice('hugo-ref:'.length).replace(/^\/?posts\//, '').replace(/\/$/, '');
    if (!target) {
      setStatus('This Hugo reference does not point to a post', true);
      return;
    }
    window.api.openHugoPost({ projectPath: hugoProjectPath, relativePath: target })
      .then((result) => { if (!result.ok) setStatus(result.error || 'Could not open referenced post', true); });
    return;
  }
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

function openImageOptions() {
  imageResizeInput.value = savedConfig.imageResize || '1500x1500';
  imageQualityInput.value = savedConfig.imageQuality ?? 70;
  thumbnailResizeInput.value = savedConfig.thumbnailResize || '500x500';
  thumbnailQualityInput.value = savedConfig.thumbnailQuality ?? 60;
  imageOptionsError.textContent = '';
  imageOptionsDialog.classList.remove('hidden');
  imageResizeInput.focus();
}

function closeImageOptions() {
  imageOptionsDialog.classList.add('hidden');
}

imageOptionsBtn.addEventListener('click', openImageOptions);
cancelImageOptionsBtn.addEventListener('click', closeImageOptions);
resetImageOptionsBtn.addEventListener('click', () => {
  imageResizeInput.value = '1500x1500';
  imageQualityInput.value = '70';
  thumbnailResizeInput.value = '500x500';
  thumbnailQualityInput.value = '60';
  imageOptionsError.textContent = '';
});
imageOptionsDialog.addEventListener('click', (event) => {
  if (event.target === imageOptionsDialog) closeImageOptions();
});
imageOptionsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const imageResize = imageResizeInput.value.trim();
  const thumbnailResize = thumbnailResizeInput.value.trim();
  const imageQuality = Number(imageQualityInput.value);
  const thumbnailQuality = Number(thumbnailQualityInput.value);
  if (!/^\d+x\d+$/i.test(imageResize) || !/^\d+x\d+$/i.test(thumbnailResize) ||
      !Number.isInteger(imageQuality) || !Number.isInteger(thumbnailQuality) ||
      imageQuality < 0 || imageQuality > 100 || thumbnailQuality < 0 || thumbnailQuality > 100) {
    imageOptionsError.textContent = 'Use dimensions such as 1500x1500 and quality values from 0 to 100.';
    return;
  }
  savedConfig = { ...savedConfig, imageResize, imageQuality, thumbnailResize, thumbnailQuality };
  if (window.api) {
    try {
      savedConfig = await window.api.saveConfig(savedConfig);
      closeImageOptions();
      setStatus('Image options saved');
    } catch (error) {
      imageOptionsError.textContent = 'Image options could not be saved.';
      console.error('Unable to save image options:', error);
    }
  }
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
  setStatus('Converting image…');
  const result = await window.api.processImage({ sourcePath: filePath });
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
    const sourcePath = window.api?.getPathForFile(imageFile) || imageFile.path;
    handleImageFile(sourcePath);
  }
});

// --- Paste (e.g. screenshot from clipboard is handled via drag/drop of a temp file;
// pasting a file path also works if the clipboard contains one) ---
editor.onPaste((e) => {
  const items = Array.from(e.clipboardData.items || []);
  const fileItem = items.find(i => i.kind === 'file');
  if (fileItem) {
    const file = fileItem.getAsFile();
    const sourcePath = file && (window.api?.getPathForFile(file) || file.path);
    if (sourcePath) {
      e.preventDefault();
      handleImageFile(sourcePath);
    }
  }
});

// --- File open/save wiring ---
if (window.api) {
  window.api.onFileOpened(({ filePath, content, projectPath }) => {
    currentFilePath = filePath;
    if (projectPath) {
      hugoProjectPath = projectPath;
      currentProjectPostName = filePath ? filePath.split('/').at(-2) : null;
      workspaceEl.classList.remove('project-closed');
    } else {
      currentProjectPostName = null;
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
  if (e.key === 'Escape' && !imageOptionsDialog.classList.contains('hidden')) {
    closeImageOptions();
    return;
  }
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
