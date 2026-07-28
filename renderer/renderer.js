const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const panes = document.getElementById('panes');
const toggleBtn = document.getElementById('toggle-preview');
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');
const lightboxEl = document.getElementById('preview-lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const closeLightboxBtn = document.getElementById('close-lightbox');

let currentFilePath = null;
let previewVisible = true;
let renderDebounce = null;

function withoutHugoFrontMatter(text) {
  const source = text || '';
  const match = source.match(/^(---|\+\+\+)\s*\r?\n[\s\S]*?\r?\n\1\s*(?:\r?\n|$)/);
  return match ? source.slice(match[0].length) : source;
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

  let html = window.marked.parse(expanded, { breaks: true });
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
    preview.innerHTML = expandLightboxShortcodes(withoutHugoFrontMatter(editor.value));
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

editor.addEventListener('input', scheduleRender);

toggleBtn.addEventListener('click', () => {
  previewVisible = !previewVisible;
  preview.classList.toggle('hidden', !previewVisible);
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

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#e06c75' : '#8f8';
  if (msg) setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

function insertAtCursor(text) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const before = editor.value.slice(0, start);
  const after = editor.value.slice(end);
  editor.value = `${before}${text}${after}`;
  const cursorPos = start + text.length;
  editor.setSelectionRange(cursorPos, cursorPos);
  editor.focus();
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
editor.addEventListener('paste', (e) => {
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
  window.api.onFileOpened(({ filePath, content }) => {
    currentFilePath = filePath;
    editor.value = content;
    filenameEl.textContent = filePath ? filePath.split('/').pop() : 'Untitled.md';
    renderPreview();
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
    content: editor.value,
    filePath: forcePicker ? null : currentFilePath
  });
  if (result.ok) {
    currentFilePath = result.filePath;
    filenameEl.textContent = currentFilePath.split('/').pop();
    setStatus('Saved');
    renderPreview(); // Resolve shortcode image paths once this post has a folder.
  }
}

// Render once after the DOM and preload bridge are both ready. Without this,
// the preview remains stale until an input or file-open event happens.
renderPreview();

// Cmd+S shortcut inside the editor itself too
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !lightboxEl.classList.contains('hidden')) {
    closeLightbox();
    return;
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveCurrent(e.shiftKey);
  }
});
