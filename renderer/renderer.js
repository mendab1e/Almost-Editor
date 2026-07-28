const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const panes = document.getElementById('panes');
const toggleBtn = document.getElementById('toggle-preview');
const filenameEl = document.getElementById('filename');
const statusEl = document.getElementById('status');

let currentFilePath = null;
let previewVisible = true;
let renderDebounce = null;

function renderPreview() {
  try {
    // Keep Markdown parsing in the preload bridge. The renderer stays isolated
    // from Node, while a parser failure is surfaced in the preview instead of
    // looking like a blank, broken split pane.
    preview.innerHTML = window.api.renderMarkdown(editor.value);
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
    preview.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src');
      if (src && !/^(https?:|file:|data:)/i.test(src)) {
        img.setAttribute('src', `file://${postDir}/${src}`);
      }
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
window.api.onFileOpened(({ filePath, content }) => {
  currentFilePath = filePath;
  editor.value = content;
  filenameEl.textContent = filePath ? filePath.split('/').pop() : 'Untitled.md';
  renderPreview();
});

async function saveCurrent(forcePicker) {
  const result = await window.api.saveFile({
    content: editor.value,
    filePath: forcePicker ? null : currentFilePath
  });
  if (result.ok) {
    currentFilePath = result.filePath;
    filenameEl.textContent = currentFilePath.split('/').pop();
    setStatus('Saved');
  }
}

window.api.onRequestSave(() => saveCurrent(false));
window.api.onRequestSaveAs(() => saveCurrent(true));

// Render once after the DOM and preload bridge are both ready. Without this,
// the preview remains stale until an input or file-open event happens.
renderPreview();

// Cmd+S shortcut inside the editor itself too
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveCurrent(e.shiftKey);
  }
});
