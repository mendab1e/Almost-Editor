import { mappedScrollTop, scrollFraction, suggestPostDirectory } from './ui-helpers.mjs';
import { imageInsertion } from './document-state.mjs';
import { createMarkdownEditor, sanitizePreview } from './editor.bundle.js';
import {
  buildMarkdownLink,
  formatMarkdownBlock,
  insertMarkdownBlock,
  wrapMarkdownSelection
} from './markdown-editing.mjs';
import {
  completeDocumentSave,
  dirtyDocumentsForClose,
  documentKeysInDirectory,
  recoverySnapshot,
  removeDocumentsInDirectory
} from './document-state.mjs';
import {
  draftFromFrontMatter,
  draftEdit,
  expandHugoRefLinks,
  featuredImageEdit,
  featuredImageFromFrontMatter,
  hugoContent,
  imagesFromMarkdown,
  titleFromFrontMatter
} from './markdown-tools.mjs';

const editorPane = document.getElementById('editor-pane');
const editorHost = document.getElementById('editor');
const formatToolbar = document.getElementById('format-toolbar');
const blockStyleSelect = document.getElementById('block-style');
const toggleDraftBtn = document.getElementById('toggle-draft');
const insertLinkBtn = document.getElementById('insert-link');
const insertFeaturedImageBtn = document.getElementById('insert-featured-image');
const preview = document.getElementById('preview');
const panes = document.getElementById('panes');
const toggleBtn = document.getElementById('toggle-preview');
const statusEl = document.getElementById('status');
const dirtyStatusEl = document.getElementById('dirty-status');
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
const linkDialog = document.getElementById('link-dialog');
const linkForm = document.getElementById('link-form');
const linkTextInput = document.getElementById('link-text');
const linkUrlInput = document.getElementById('link-url');
const linkPostSelect = document.getElementById('link-post');
const linkUrlFields = document.getElementById('link-url-fields');
const linkPostFields = document.getElementById('link-post-fields');
const linkError = document.getElementById('link-error');
const cancelLinkBtn = document.getElementById('cancel-link');
const featuredImageDialog = document.getElementById('featured-image-dialog');
const featuredImageForm = document.getElementById('featured-image-form');
const featuredImageOptions = document.getElementById('featured-image-options');
const featuredImageEmpty = document.getElementById('featured-image-empty');
const confirmFeaturedImageBtn = document.getElementById('confirm-featured-image');
const cancelFeaturedImageBtn = document.getElementById('cancel-featured-image');
const imageOptionsDialog = document.getElementById('image-options-dialog');
const imageOptionsForm = document.getElementById('image-options-form');
const imageResizeInput = document.getElementById('image-resize');
const imageQualityInput = document.getElementById('image-quality');
const thumbnailResizeInput = document.getElementById('thumbnail-resize');
const thumbnailQualityInput = document.getElementById('thumbnail-quality');
const imageShortcodeTemplateInput = document.getElementById('image-shortcode-template');
const imageOptionsError = document.getElementById('image-options-error');
const cancelImageOptionsBtn = document.getElementById('cancel-image-options');
const resetImageSizeBtn = document.getElementById('reset-image-size');
const resetImageShortcodeBtn = document.getElementById('reset-image-shortcode');
const lightboxEl = document.getElementById('preview-lightbox');
const lightboxImage = document.getElementById('lightbox-image');
const closeLightboxBtn = document.getElementById('close-lightbox');

let currentFilePath = null;
let currentDocumentKey = `draft:${crypto.randomUUID()}`;
let previewVisible = true;
let renderDebounce = null;
let previewScrollTargets = [];
let savedConfig = { theme: 'system', fontSize: 15 };
let hugoProjectPath = null;
let currentProjectPostName = null;
let hugoPosts = [];
let pendingLinkSelection = null;
let windowCloseInProgress = false;
const openDocuments = new Map([
  [currentDocumentKey, { savedContent: '', content: '', dirty: false, filePath: null, projectPath: null }]
]);
let documentMenuSignature = '';
let recoveryReady = false;
let recoveryTimer;
let recoveryWrite = Promise.resolve();
const pendingSaves = new Set();
const pendingImages = new Set();
let saveQueue = Promise.resolve();

function updateDocumentMenu() {
  let untitled = 0;
  const documents = Array.from(openDocuments, ([key, draft]) => ({
    key,
    label: `${draft.filePath || `Untitled ${++untitled}`}${draft.dirty ? ' ●' : ''}`,
    active: key === currentDocumentKey
  }));
  const signature = JSON.stringify(documents);
  if (!window.api || signature === documentMenuSignature) return;
  documentMenuSignature = signature;
  window.api.updateDocumentMenu(documents).catch(error => {
    documentMenuSignature = '';
    console.error('Unable to update document menu:', error);
  });
}

function flushRecovery() {
  clearTimeout(recoveryTimer);
  recoveryTimer = null;
  if (!recoveryReady) return recoveryWrite;
  const snapshot = recoverySnapshot(openDocuments, currentDocumentKey);
  recoveryWrite = recoveryWrite.catch(() => {}).then(async () => {
    const result = await window.api.saveRecovery(snapshot);
    if (!result.ok) throw new Error(result.error || 'Recovery could not be saved');
  });
  return recoveryWrite;
}

function scheduleRecovery() {
  if (!recoveryReady) return;
  // Bound the recovery window even while typing continuously.
  if (recoveryTimer) return;
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null;
    flushRecovery().catch(error => setStatus(`Draft recovery failed: ${error.message}`, true));
  }, 300);
}

function activateDocument(key) {
  hideWelcome();
  const draft = openDocuments.get(key);
  if (!draft) return;
  currentDocumentKey = key;
  currentFilePath = draft.filePath;
  currentProjectPostName = draft.projectPath && draft.filePath ? draft.filePath.split('/').at(-2) : null;
  if (!draft.projectPath) closeProjectSidebar();
  else hugoProjectPath = draft.projectPath;
  window.api.setActiveFile({ filePath: draft.filePath, projectPath: draft.projectPath });
  editor.setValue(draft.content);
  updateHeader();
  updateDirtyStatus();
  highlightCurrentPost();
  renderPreview();
  scheduleRecovery();
}

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
const editor = createMarkdownEditor(editorHost, handleEditorChange);
const DEFAULT_IMAGE_OPTIONS = {
  imageResize: '1500x1500',
  imageQuality: 70,
  thumbnailResize: '500x500',
  thumbnailQuality: 60
};
const DEFAULT_IMAGE_SHORTCODE = '{{< lightbox src="{src}" thumb="{thumb}" alt="{alt}" >}}';

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
  updateSyncToggle();
  renderRecentDocuments();
}

themeSelect.addEventListener('change', async () => {
  const theme = themeSelect.value;
  savedConfig = { ...savedConfig, theme };
  applyTheme();
  if (window.api) {
    try {
      savedConfig = await window.api.saveConfig({ theme });
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
      savedConfig = await window.api.saveConfig({ fontSize });
    } catch (error) {
      setStatus('Text size preference could not be saved', true);
      console.error('Unable to save text size preference:', error);
    }
  }
});

systemTheme.addEventListener('change', () => {
  if (savedConfig.theme === 'system') applyTheme();
});

function updateHeader() {
  const title = titleFromFrontMatter(editor.getValue()) ||
    (currentFilePath ? currentFilePath.split('/').pop() : 'Untitled');
  document.title = `Almost Editor – ${title}`;
  updateFrontMatterButtons();
}

function updateFrontMatterButtons() {
  const content = editor.getValue();
  const isDraft = draftFromFrontMatter(content);
  const hasFeaturedImage = Boolean(featuredImageFromFrontMatter(content));
  toggleDraftBtn.setAttribute('aria-pressed', String(isDraft));
  toggleDraftBtn.title = isDraft ? 'Mark as published' : 'Mark as draft';
  insertFeaturedImageBtn.setAttribute('aria-pressed', String(hasFeaturedImage));
  insertFeaturedImageBtn.title = hasFeaturedImage ? 'Change featured image' : 'Set featured image';
}

function handleEditorChange() {
  const document = openDocuments.get(currentDocumentKey);
  if (document) {
    document.content = editor.getValue();
    document.dirty = document.content !== document.savedContent;
    scheduleRecovery();
    updateDirtyStatus();
  }
  updateHeader();
  updatePostTitles();
  scheduleRender();
}

function documentKey(filePath) {
  return filePath || `draft:${crypto.randomUUID()}`;
}

function updateDirtyStatus() {
  const document = openDocuments.get(currentDocumentKey);
  dirtyStatusEl.classList.toggle('hidden', !document?.dirty);
  updatePostDirtyIndicators();
  updatePostTitles();
  updateDocumentMenu();
}

function updatePostDirtyIndicators() {
  postListEl.querySelectorAll('.post-entry').forEach((button) => {
    const document = openDocuments.get(documentKey(button.dataset.filePath));
    button.querySelector('.post-entry-dirty')?.classList.toggle('hidden', !document?.dirty);
  });
}

function openDocument(filePath, diskContent) {
  const key = documentKey(filePath);
  let document = openDocuments.get(key);
  // A dirty buffer is the user's in-memory draft. Prefer it over a fresh read
  // from disk when returning to a sidebar post; clean documents can refresh.
  if (!document) {
    document = { savedContent: diskContent, content: diskContent, dirty: false, filePath, projectPath: hugoProjectPath };
    openDocuments.set(key, document);
  } else if (!document.dirty) {
    document.savedContent = diskContent;
    document.content = diskContent;
    document.projectPath = hugoProjectPath;
  }
  currentDocumentKey = key;
  editor.setValue(document.content);
  scheduleRecovery();
  updateDirtyStatus();
}

function setupHorizontalResizer(handle, getStartWidth, resize) {
  handle.title = 'Drag or use Left and Right arrow keys to resize';
  new ResizeObserver(() => {
    handle.setAttribute('aria-valuemin', '0');
    handle.setAttribute('aria-valuemax', Math.round(window.innerWidth));
    handle.setAttribute('aria-valuenow', Math.round(getStartWidth()));
    handle.setAttribute('aria-valuetext', `${Math.round(getStartWidth())} pixels`);
  }).observe(handle.parentElement);
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    resize((event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 50 : 10), getStartWidth());
    handle.setAttribute('aria-valuenow', Math.round(getStartWidth()));
    handle.setAttribute('aria-valuetext', `${Math.round(getStartWidth())} pixels`);
  });
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

setupHorizontalResizer(previewResizer, () => editorPane.getBoundingClientRect().width, (delta, startWidth) => {
  const usableWidth = panes.getBoundingClientRect().width - previewResizer.getBoundingClientRect().width;
  const minimum = Math.min(240, usableWidth / 2);
  const editorWidth = Math.max(minimum, Math.min(usableWidth - minimum, startWidth + delta));
  const share = usableWidth > 0 ? editorWidth / usableWidth : 0.5;
  const dividerWidth = previewResizer.getBoundingClientRect().width;
  // Store the chosen proportion, so window and sidebar resizing affect both panes.
  editorPane.style.flex = `0 0 calc(${share * 100}% - ${share * dividerWidth}px)`;
  preview.style.flex = '1 1 0';
});

function balanceEditorAndPreview() {
  editorPane.style.flex = '1 1 50%';
  preview.style.flex = '1 1 50%';
}

function closeProjectSidebar() {
  hugoProjectPath = null;
  hugoPosts = [];
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
    button.dataset.postPath = post.relativePath;
    button.dataset.filePath = `${hugoProjectPath}/content/posts/${post.relativePath}/index.md`;
    const label = document.createElement('span');
    label.className = 'post-entry-label';
    const heading = document.createElement('span');
    heading.className = 'post-entry-heading';
    const title = document.createElement('span');
    title.className = 'post-title';
    title.textContent = titleFromFrontMatter(post.frontMatter || '') || post.name;
    const draft = document.createElement('span');
    draft.className = 'post-entry-draft';
    draft.classList.toggle('hidden', !draftFromFrontMatter(post.frontMatter || ''));
    draft.textContent = 'DRAFT';
    const directory = document.createElement('small');
    directory.textContent = post.relativePath;
    heading.append(title, draft);
    label.append(heading, directory);
    const dirty = document.createElement('span');
    dirty.className = 'post-entry-dirty hidden';
    dirty.textContent = '●';
    dirty.setAttribute('aria-label', 'Unsaved changes');
    button.append(label, dirty);
    postListEl.append(button);
  }
  updatePostDirtyIndicators();
  updatePostTitles();
}

function showEmptyProject(projectPath) {
  let entry = Array.from(openDocuments).find(([, document]) => (
    !document.filePath && !document.dirty && document.content === ''
  ));
  if (!entry) {
    const key = `draft:${crypto.randomUUID()}`;
    const document = { savedContent: '', content: '', dirty: false, filePath: null, projectPath };
    openDocuments.set(key, document);
    entry = [key, document];
  }
  entry[1].projectPath = projectPath;
  hugoProjectPath = projectPath;
  workspaceEl.classList.remove('project-closed');
  activateDocument(entry[0]);
}

function highlightCurrentPost() {
  postListEl.querySelectorAll('.post-entry').forEach((button) => {
    const expectedEnding = `/content/posts/${button.dataset.postPath}/index.md`;
    const active = Boolean(currentFilePath && currentFilePath.endsWith(expectedEnding));
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
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
    attributes[match[1]] = (match[2] ?? match[3] ?? match[4] ?? '').replace(/&(amp|quot|lt|gt);/g, (_, entity) => ({ amp: '&', quot: '"', lt: '<', gt: '>' })[entity]);
  }
  return attributes;
}

function expandLightboxShortcodes(markdown, firstSourceLine) {
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

  // Add zero-height anchors before rendered blocks so scroll synchronization
  // can match content even when Markdown and HTML have very different heights.
  const tokens = window.marked.lexer(expanded, { breaks: false });
  const anchoredTokens = [];
  let sourceLine = firstSourceLine;
  for (const token of tokens) {
    if (token.type !== 'space' && token.type !== 'def') {
      anchoredTokens.push({
        type: 'html',
        raw: '',
        block: true,
        text: `<span class="preview-scroll-anchor" data-source-line="${sourceLine}"></span>`
      });
    }
    anchoredTokens.push(token);
    sourceLine += token.raw?.match(/\n/g)?.length || 0;
  }

  // Hugo's Goldmark renderer treats an ordinary source newline as whitespace,
  // not as an HTML <br>. This keeps URLs and other inline Markdown together.
  let html = window.marked.parser(anchoredTokens, { breaks: false });
  for (const { placeholder, figure } of replacements) {
    html = html.replace(`<p>${placeholder}</p>\n`, figure);
    html = html.replace(placeholder, figure);
  }
  return html;
}

function localPreviewUrl(source) {
  if (!source || /^(https?:|file:|data:|hugo-ref:|#)/i.test(source) || !currentFilePath) return source;
  const postDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
  return new URL(source, `file://${postDir}/`).href;
}

function collectPreviewScrollTargets() {
  const targets = new Map();
  const anchors = [...preview.querySelectorAll('.preview-scroll-anchor[data-source-line]')];
  for (const anchor of anchors) {
    let element = anchor.nextElementSibling;
    while (element?.classList.contains('preview-scroll-anchor')) element = element.nextElementSibling;
    const sourceLine = Number(anchor.dataset.sourceLine);
    if (element && Number.isInteger(sourceLine)) targets.set(element, sourceLine);
    anchor.remove();
  }
  previewScrollTargets = [...targets].map(([element, sourceLine]) => ({ element, sourceLine }));
}

function renderPreview() {
  try {
    if (!window.marked) throw new Error('Markdown parser failed to load');
    // Hugo removes front matter before rendering a page. Do the same for the
    // editor preview, then render with Marked's browser bundle.
    const { content, startLine } = hugoContent(editor.getValue());
    const markdown = expandHugoRefLinks(content);
    preview.innerHTML = sanitizePreview(expandLightboxShortcodes(markdown, startLine));
    collectPreviewScrollTargets();
  } catch (error) {
    previewScrollTargets = [];
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

  if (savedConfig.syncScroll) syncScroll(scroller, preview);
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
  if (!link) {
    const ordinaryLink = event.target.closest('a[href]');
    if (ordinaryLink) {
      event.preventDefault();
      const href = ordinaryLink.getAttribute('href');
      if (href.startsWith('#')) {
        document.getElementById(href.slice(1))?.scrollIntoView();
      } else {
        window.api?.openExternal(href);
      }
    }
    return;
  }
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
  imageResizeInput.value = savedConfig.imageResize || DEFAULT_IMAGE_OPTIONS.imageResize;
  imageQualityInput.value = savedConfig.imageQuality ?? DEFAULT_IMAGE_OPTIONS.imageQuality;
  thumbnailResizeInput.value = savedConfig.thumbnailResize || DEFAULT_IMAGE_OPTIONS.thumbnailResize;
  thumbnailQualityInput.value = savedConfig.thumbnailQuality ?? DEFAULT_IMAGE_OPTIONS.thumbnailQuality;
  imageShortcodeTemplateInput.value = savedConfig.imageShortcodeTemplate || DEFAULT_IMAGE_SHORTCODE;
  imageOptionsError.textContent = '';
  imageOptionsDialog.classList.remove('hidden');
  imageResizeInput.focus();
}

function closeImageOptions() {
  imageOptionsDialog.classList.add('hidden');
}

imageOptionsBtn.addEventListener('click', openImageOptions);
cancelImageOptionsBtn.addEventListener('click', closeImageOptions);
resetImageSizeBtn.addEventListener('click', () => {
  imageResizeInput.value = DEFAULT_IMAGE_OPTIONS.imageResize;
  imageQualityInput.value = String(DEFAULT_IMAGE_OPTIONS.imageQuality);
  thumbnailResizeInput.value = DEFAULT_IMAGE_OPTIONS.thumbnailResize;
  thumbnailQualityInput.value = String(DEFAULT_IMAGE_OPTIONS.thumbnailQuality);
  imageOptionsError.textContent = '';
});
resetImageShortcodeBtn.addEventListener('click', () => {
  imageShortcodeTemplateInput.value = DEFAULT_IMAGE_SHORTCODE;
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
  const imageShortcodeTemplate = imageShortcodeTemplateInput.value.trim();
  if (!/^\d+x\d+$/i.test(imageResize) || !/^\d+x\d+$/i.test(thumbnailResize) ||
      !Number.isInteger(imageQuality) || !Number.isInteger(thumbnailQuality) ||
      imageQuality < 0 || imageQuality > 100 || thumbnailQuality < 0 || thumbnailQuality > 100) {
    imageOptionsError.textContent = 'Use dimensions such as 1500x1500 and quality values from 0 to 100.';
    return;
  }
  if (!imageShortcodeTemplate.includes('{src}')) {
    imageOptionsError.textContent = 'The shortcode template must include the {src} placeholder.';
    return;
  }
  const imageOptions = {
    imageResize,
    imageQuality,
    thumbnailResize,
    thumbnailQuality,
    imageShortcodeTemplate
  };
  savedConfig = { ...savedConfig, ...imageOptions };
  if (window.api) {
    try {
      savedConfig = await window.api.saveConfig(imageOptions);
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
  document.getElementById('new-post-heading').value = '';
  directoryEdited = false;
  updatePostLocation();
  newPostDialog.classList.remove('hidden');
  document.getElementById('new-post-heading').focus();
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
  const result = await window.api.createHugoPost({ projectPath: hugoProjectPath, name, title: document.getElementById('new-post-heading').value.trim() });
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

postListEl.addEventListener('contextmenu', (event) => {
  const button = event.target.closest('.post-entry');
  if (!button || !window.api || !hugoProjectPath) return;
  event.preventDefault();
  const postDirectory = button.dataset.filePath.replace(/\/index\.md$/, '');
  const hasUnsavedChanges = documentKeysInDirectory(openDocuments, postDirectory)
    .some(key => openDocuments.get(key)?.dirty);
  window.api.showHugoPostContextMenu({
    projectPath: hugoProjectPath,
    relativePath: button.dataset.postPath,
    hasUnsavedChanges
  }).then((result) => {
    if (!result.ok) setStatus(result.error || 'Could not open the post menu', true);
  }).catch(error => setStatus(`Could not open the post menu: ${error.message}`, true));
});

function applyEditorEdit(edit) {
  editor.replaceRange(edit.from, edit.to, edit.insert, edit.selectionStart, edit.selectionEnd);
}

function applyInlineFormat(prefix, suffix = prefix, placeholder = 'text') {
  const selection = editor.getSelection();
  applyEditorEdit(wrapMarkdownSelection(editor.getValue(), selection.from, selection.to, prefix, suffix, placeholder));
}

function applyBlockFormat(style) {
  const selection = editor.getSelection();
  applyEditorEdit(formatMarkdownBlock(editor.getValue(), selection.from, selection.to, style));
}

function applyFormat(format) {
  const inlineFormats = {
    bold: ['**', '**', 'bold text'],
    italic: ['*', '*', 'italic text'],
    strikethrough: ['~~', '~~', 'struck text'],
    code: ['`', '`', 'code']
  };
  if (inlineFormats[format]) {
    applyInlineFormat(...inlineFormats[format]);
    return;
  }

  if (['blockquote', 'unordered', 'ordered', 'task'].includes(format)) {
    applyBlockFormat(format);
    return;
  }

  const selection = editor.getSelection();
  if (format === 'codeblock') {
    applyEditorEdit(insertMarkdownBlock(
      editor.getValue(),
      selection.from,
      selection.to,
      (content) => `\`\`\`\n${content}\n\`\`\``,
      'code'
    ));
  } else if (format === 'rule') {
    applyEditorEdit(insertMarkdownBlock(editor.getValue(), selection.to, selection.to, () => '---'));
  }
}

formatToolbar.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-format]');
  if (button) applyFormat(button.dataset.format);
});

blockStyleSelect.addEventListener('change', () => {
  if (!blockStyleSelect.value) return;
  applyBlockFormat(blockStyleSelect.value);
  blockStyleSelect.value = '';
});

function selectedLinkType() {
  return linkForm.elements.linkType.value;
}

function updateLinkTargetFields() {
  const isPost = selectedLinkType() === 'post';
  linkUrlFields.classList.toggle('hidden', isPost);
  linkPostFields.classList.toggle('hidden', !isPost);
  linkUrlInput.disabled = isPost;
  linkPostSelect.disabled = !isPost;
}

function populateLinkPostOptions() {
  linkPostSelect.replaceChildren();
  if (!hugoPosts.length) {
    const option = document.createElement('option');
    option.textContent = 'Open a Hugo project to select an article';
    option.value = '';
    option.disabled = true;
    option.selected = true;
    linkPostSelect.append(option);
    return;
  }

  for (const post of hugoPosts) {
    const option = document.createElement('option');
    option.value = post.relativePath;
    option.textContent = titleFromFrontMatter(post.frontMatter || '') || post.name;
    linkPostSelect.append(option);
  }
}

function openLinkDialog() {
  pendingLinkSelection = editor.getSelection();
  linkTextInput.value = pendingLinkSelection.text;
  linkUrlInput.value = '';
  linkError.textContent = '';
  linkForm.elements.linkType.value = 'url';
  populateLinkPostOptions();
  updateLinkTargetFields();
  linkDialog.classList.remove('hidden');
  (pendingLinkSelection.text ? linkUrlInput : linkTextInput).focus();
}

function closeLinkDialog() {
  linkDialog.classList.add('hidden');
  pendingLinkSelection = null;
  editor.focus();
}

insertLinkBtn.addEventListener('click', openLinkDialog);
linkForm.addEventListener('change', (event) => {
  if (event.target.name === 'linkType') {
    updateLinkTargetFields();
    (selectedLinkType() === 'post' ? linkPostSelect : linkUrlInput).focus();
  }
});
cancelLinkBtn.addEventListener('click', closeLinkDialog);
linkDialog.addEventListener('click', (event) => {
  if (event.target === linkDialog) closeLinkDialog();
});
linkForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!pendingLinkSelection) return;

  try {
    const type = selectedLinkType();
    const value = type === 'post' ? linkPostSelect.value : linkUrlInput.value;
    const markdown = buildMarkdownLink(linkTextInput.value, { type, value });
    const selection = pendingLinkSelection;
    linkDialog.classList.add('hidden');
    pendingLinkSelection = null;
    editor.replaceRange(selection.from, selection.to, markdown);
    setStatus(type === 'post' ? 'Article link inserted' : 'Link inserted');
  } catch (error) {
    linkError.textContent = error.message;
  }
});

function imageLabel(image) {
  return image.alt || image.src.split(/[\\/]/).pop() || image.src;
}

function applyFrontMatterEdit(edit) {
  const selection = editor.getSelection();
  const delta = edit.insert.length - (edit.to - edit.from);
  const adjustedPosition = (position) => position <= edit.from ? position : position >= edit.to ? position + delta : edit.from + edit.insert.length;
  editor.replaceRange(edit.from, edit.to, edit.insert, adjustedPosition(selection.from), adjustedPosition(selection.to));
}

toggleDraftBtn.addEventListener('click', () => {
  const isDraft = draftFromFrontMatter(editor.getValue());
  applyFrontMatterEdit(draftEdit(editor.getValue(), !isDraft));
  setStatus(isDraft ? 'Post marked as published' : 'Post marked as draft');
});

function openFeaturedImageDialog() {
  const content = editor.getValue();
  const images = imagesFromMarkdown(content);
  const featuredImage = featuredImageFromFrontMatter(content);
  const selectedIndex = Math.max(0, images.findIndex((image) => image.src === featuredImage));
  featuredImageOptions.replaceChildren();
  for (const [index, image] of images.entries()) {
    const option = document.createElement('label');
    option.className = 'featured-image-option';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'featuredImage';
    input.value = image.src;
    input.checked = index === selectedIndex;
    const previewImage = document.createElement('img');
    previewImage.src = localPreviewUrl(image.previewSrc);
    previewImage.alt = '';
    const label = document.createElement('span');
    label.textContent = imageLabel(image);
    option.append(input, previewImage, label);
    featuredImageOptions.append(option);
  }
  featuredImageEmpty.classList.toggle('hidden', images.length > 0);
  confirmFeaturedImageBtn.disabled = images.length === 0;
  featuredImageDialog.classList.remove('hidden');
  (featuredImageOptions.querySelector('input') || cancelFeaturedImageBtn).focus();
}

function closeFeaturedImageDialog() {
  featuredImageDialog.classList.add('hidden');
  editor.focus();
}

insertFeaturedImageBtn.addEventListener('click', openFeaturedImageDialog);
cancelFeaturedImageBtn.addEventListener('click', closeFeaturedImageDialog);
featuredImageDialog.addEventListener('click', (event) => {
  if (event.target === featuredImageDialog) closeFeaturedImageDialog();
});
featuredImageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const imagePath = new FormData(featuredImageForm).get('featuredImage');
  if (!imagePath) return;
  const edit = featuredImageEdit(editor.getValue(), imagePath);
  closeFeaturedImageDialog();
  applyFrontMatterEdit(edit);
  setStatus('Featured image set');
});

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.style.color = isError ? '#e06c75' : 'var(--success)';
  if (msg) setTimeout(() => { statusEl.textContent = ''; }, 3000);
}

function insertAtCursor(text) {
  editor.insertAtCursor(text);
}

function handleImageFile(filePath, alt = '', context = null) {
  if (windowCloseInProgress) return Promise.resolve();
  const operation = insertImageFile(filePath, alt, context);
  pendingImages.add(operation);
  updateImageProgress();
  operation.finally(() => { pendingImages.delete(operation); updateImageProgress(); });
  return operation;
}

async function insertImageFile(filePath, alt, context) {
  if (!window.api) {
    setStatus('Image processing is unavailable because the Electron API did not load', true);
    return;
  }
  const originKey = context?.key || currentDocumentKey;
  const originalContent = context?.content ?? editor.getValue();
  const position = context?.position ?? editor.getSelection().from;
  setStatus('Inserting image…');
  const result = await window.api.processImage({ sourcePath: filePath, alt, filePath: context?.filePath || currentFilePath })
    .catch((error) => ({ ok: false, error: error.message || 'Image processing failed' }));
  if (!result.ok) {
    setStatus(result.error, true);
    window.alert(result.error);
    return;
  }
  const origin = openDocuments.get(originKey);
  if (!origin) {
    setStatus('Image saved in the original post; insertion cancelled because the document moved', true);
    return;
  }
  const edit = imageInsertion(origin.content, originalContent, position, result.tag);
  if (currentDocumentKey === originKey) {
    editor.replaceRange(edit.from, edit.from, edit.insert);
  } else {
    origin.content = origin.content.slice(0, edit.from) + edit.insert + origin.content.slice(edit.from);
    origin.dirty = origin.content !== origin.savedContent;
    updateDirtyStatus();
  }
  scheduleRecovery();
  setStatus('Image inserted');
  renderPreview();
}

// --- Drag & drop ---
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (Array.from(e.dataTransfer.types).includes('Files')) editorPane.classList.add('image-dragging');
});
document.addEventListener('dragleave', e => { if (!e.relatedTarget) editorPane.classList.remove('image-dragging'); });
window.addEventListener('blur', () => editorPane.classList.remove('image-dragging'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  editorPane.classList.remove('image-dragging');
  if (document.querySelector('.modal:not(.hidden)')) return;
  const files = Array.from(e.dataTransfer.files);
  const imageFile = files.find(f => /\.(png|jpe?g|gif|heic|tiff?|bmp|webp)$/i.test(f.name));
  if (imageFile) {
    const sourcePath = window.api?.getPathForFile(imageFile) || imageFile.path;
    promptImage(sourcePath);
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
      promptImage(sourcePath);
    }
  }
});

// --- File open/save wiring ---
if (window.api) {
  window.api.onActivateDocument((key) => {
    if (!windowCloseInProgress) activateDocument(key);
  });
  window.api.onDraftsRecovered((snapshot) => {
    if (snapshot.error) {
      setStatus(`Draft recovery could not be read: ${snapshot.error}`, true);
      window.alert('The recovery file could not be read. It has been preserved in the app data folder.');
      return;
    }
    for (const draft of snapshot.documents) {
      openDocuments.set(draft.key, { ...draft, dirty: draft.content !== draft.savedContent });
    }
    recoveryReady = true;
    if (snapshot.documents.length) {
      const key = snapshot.documents.some(draft => draft.key === snapshot.activeKey)
        ? snapshot.activeKey : snapshot.documents[0].key;
      activateDocument(key);
      setStatus(`${snapshot.documents.length} unsaved drafts recovered`);
    }
    updateDocumentMenu();
  });

  window.api.onFileOpened(({ filePath, content, projectPath }) => {
    hideWelcome();
    currentFilePath = filePath;
    if (projectPath) {
      hugoProjectPath = projectPath;
      currentProjectPostName = filePath ? filePath.split('/').at(-2) : null;
      workspaceEl.classList.remove('project-closed');
    } else {
      currentProjectPostName = null;
      closeProjectSidebar();
    }
    openDocument(filePath, content);
    updateHeader();
    highlightCurrentPost();
    renderPreview();
  });

  window.api.onProjectOpened(({ projectPath, posts }) => {
    hideWelcome();
    document.getElementById('post-search').value = '';
    hugoProjectPath = projectPath;
    hugoPosts = posts;
    workspaceEl.classList.remove('project-closed');
    projectNameEl.textContent = projectPath.split('/').pop();
    projectNameEl.title = projectPath;
    renderPostList(posts);
    highlightCurrentPost();
    setStatus(`${posts.length} Hugo posts loaded`);
  });

  window.api.onHugoPostDeleted(async ({ projectPath, relativePath, postDirectory, posts }) => {
    const removedKeys = removeDocumentsInDirectory(openDocuments, postDirectory);
    const activePostWasDeleted = removedKeys.includes(currentDocumentKey);
    hugoProjectPath = projectPath;
    hugoPosts = posts;
    workspaceEl.classList.remove('project-closed');
    renderPostList(posts);

    if (activePostWasDeleted) {
      const openProjectDocument = Array.from(openDocuments)
        .find(([, document]) => document.projectPath === projectPath && document.filePath);
      if (openProjectDocument) {
        activateDocument(openProjectDocument[0]);
      } else if (posts.length) {
        try {
          const result = await window.api.openHugoPost({
            projectPath,
            relativePath: posts[0].relativePath
          });
          if (!result.ok) showEmptyProject(projectPath);
        } catch {
          showEmptyProject(projectPath);
        }
      } else {
        showEmptyProject(projectPath);
      }
    } else {
      highlightCurrentPost();
      updateDirtyStatus();
    }

    flushRecovery().catch(error => setStatus(`Draft recovery failed: ${error.message}`, true));
    setStatus(`Deleted post “${relativePath}”`);
  });

  window.api.onRequestSave(() => saveCurrent(false));
  window.api.onRequestSaveAs(() => saveCurrent(true));
  window.api.onRequestWindowClose(handleWindowCloseRequest);
} else {
  console.error('Electron preload API was not loaded');
  setStatus('File actions unavailable: Electron preload API did not load', true);
}

function queueDocumentSave(document, forcePicker) {
  // Serialize saves so an older response cannot overwrite a newer saved baseline.
  const operation = saveQueue.catch(() => {}).then(async () => {
    const content = document.content;
    const expectedContent = document.savedContent;
    // Persist the draft before invoking a dialog or touching its Markdown file.
    await flushRecovery();
    const protectedPaths = Array.from(openDocuments.values())
      .filter(draft => draft !== document && draft.filePath)
      .map(draft => draft.filePath);
    const result = await window.api.saveFile({ content, expectedContent,
      filePath: document.filePath, forcePicker, protectedPaths });
    if (!result.ok) {
      if (result.error) setStatus(result.error, true);
      return false;
    }
    const activeDocument = openDocuments.get(currentDocumentKey);
    const previousPath = document.filePath;
    const moved = completeDocumentSave(openDocuments, document, content, result.filePath);
    if (previousPath !== result.filePath) document.projectPath = null;
    if (moved && activeDocument === document) {
      currentDocumentKey = moved.key;
      currentFilePath = result.filePath;
      window.api.setActiveFile({ filePath: result.filePath });
      if (!document.projectPath) { currentProjectPostName = null; closeProjectSidebar(); }
      updateHeader();
      renderPreview();
    }
    updateDirtyStatus();
    await flushRecovery();
    setStatus(document.dirty ? 'Saved; newer edits are still unsaved' : 'Saved');
    return !document.dirty;
  }).catch(error => {
    setStatus(`Save failed: ${error.message}`, true);
    return false;
  });
  saveQueue = operation;
  pendingSaves.add(operation);
  operation.finally(() => pendingSaves.delete(operation));
  return operation;
}

function saveCurrent(forcePicker) {
  if (!window.api || windowCloseInProgress) return Promise.resolve(false);
  return queueDocumentSave(openDocuments.get(currentDocumentKey), forcePicker);
}

async function saveDirtyDocumentsForClose(dirtyDocuments) {
  for (const [, document] of dirtyDocuments) {
    if (!(await queueDocumentSave(document, !document.filePath))) return false;
  }
  return !dirtyDocumentsForClose(openDocuments, currentDocumentKey).length;
}

async function handleWindowCloseRequest() {
  if (windowCloseInProgress) return;
  windowCloseInProgress = true;
  workspaceEl.inert = true;
  document.getElementById('welcome').inert = true;
  document.getElementById('toolbar').inert = true;
  document.activeElement?.blur();
  try {
    await Promise.all([...pendingSaves, ...pendingImages]);
    const dirtyDocuments = dirtyDocumentsForClose(openDocuments, currentDocumentKey);
    if (!dirtyDocuments.length) {
      await flushRecovery();
      recoveryReady = false;
      await window.api.finishWindowClose({ close: true });
      return;
    }

    const { action } = await window.api.confirmWindowClose({ dirtyCount: dirtyDocuments.length });
    if (action === 'cancel') {
      await window.api.finishWindowClose({ close: false });
      return;
    }
    if (action === 'save' && !(await saveDirtyDocumentsForClose(dirtyDocuments))) {
      await window.api.finishWindowClose({ close: false });
      return;
    }
    await flushRecovery();
    recoveryReady = false;
    await window.api.finishWindowClose({ close: true, discardRecovery: action === 'discard' });
  } catch (error) {
    recoveryReady = true;
    console.error('Unable to finish closing the window:', error);
    setStatus('The window could not be closed', true);
    await window.api.finishWindowClose({ close: false });
  } finally {
    workspaceEl.inert = false;
    document.getElementById('welcome').inert = false;
    document.getElementById('toolbar').inert = false;
    windowCloseInProgress = false;
  }
}

// Render once after the DOM and preload bridge are both ready. Without this,
// the preview remains stale until an input or file-open event happens.
initializeTheme();
balanceEditorAndPreview();
renderPreview();
updateDocumentMenu();

// Cmd+S shortcut inside the editor itself too
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !linkDialog.classList.contains('hidden')) {
    closeLinkDialog();
    return;
  }
  if (e.key === 'Escape' && !imageOptionsDialog.classList.contains('hidden')) {
    closeImageOptions();
    return;
  }
  if (e.key === 'Escape' && !featuredImageDialog.classList.contains('hidden')) {
    closeFeaturedImageDialog();
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
    return;
  }
  if (!linkDialog.classList.contains('hidden') || !newPostDialog.classList.contains('hidden') ||
      !featuredImageDialog.classList.contains('hidden') ||
      !imageOptionsDialog.classList.contains('hidden')) return;
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
    const shortcut = e.key.toLowerCase();
    if (shortcut === 'b' || shortcut === 'i') {
      e.preventDefault();
      applyFormat(shortcut === 'b' ? 'bold' : 'italic');
    } else if (shortcut === 'k') {
      e.preventDefault();
      if (linkDialog.classList.contains('hidden')) openLinkDialog();
    }
  }
});


function hideWelcome() {
  document.body.classList.remove('is-home');
  document.getElementById('welcome').classList.add('hidden');
  workspaceEl.classList.remove('hidden');
}
async function showWelcome() {
  document.body.classList.add('is-home');
  const welcome = document.getElementById('welcome');
  welcome.classList.remove('hidden');
  workspaceEl.classList.add('hidden');
  document.getElementById('welcome-project').focus();
  try { savedConfig = await window.api.getConfig(); renderRecentDocuments(); }
  catch { setStatus('Recent documents could not be loaded', true); }
}
let recentRenderVersion = 0;
async function renderRecentDocuments() {
  const version = ++recentRenderVersion;
  let entries;
  try { entries = await window.api.getRecentDocuments(); }
  catch { entries = savedConfig.recentDocuments || []; }
  if (version !== recentRenderVersion) return;
  const list = document.getElementById('recent-documents');
  list.replaceChildren();
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    const name = document.createElement('span');
    const draft = openDocuments.get(entry.filePath);
    name.textContent = (draft && titleFromFrontMatter(draft.content)) || entry.title || (entry.filePath.endsWith('/index.md') ? entry.filePath.split('/').at(-2) : entry.filePath.split('/').pop());
    const location = document.createElement('small');
    location.textContent = entry.filePath;
    button.append(name, location);
    button.title = entry.filePath;
    button.addEventListener('click', async () => {
      const result = await window.api.openRecent(entry.filePath);
      if (!result.ok) setStatus(result.error || 'Could not open document', true);
    });
    list.append(button);
  }
  if (!list.children.length) list.textContent = 'Documents you open will appear here.';
}
document.getElementById('clear-recents').addEventListener('click', async () => {
  await window.api.clearRecentDocuments();
  savedConfig.recentDocuments = [];
  renderRecentDocuments();
});
document.getElementById('show-welcome').addEventListener('click', showWelcome);
document.getElementById('welcome-back').addEventListener('click', () => { hideWelcome(); editor.focus(); });
document.getElementById('welcome-project').addEventListener('click', () => window.api.openHugoProjectDialog());
document.getElementById('welcome-file').addEventListener('click', () => window.api.openFileDialog());
document.getElementById('welcome-new').addEventListener('click', () => window.api.newFile());
// Session restoration events hide this screen when there is a document or project to resume.
if (!currentFilePath && !hugoProjectPath && !editor.getValue()) {
  document.body.classList.add('is-home');
  document.getElementById('welcome').classList.remove('hidden');
  workspaceEl.classList.add('hidden');
}

function updatePostTitles() {
  for (const button of postListEl.querySelectorAll('.post-entry')) {
    const draft = openDocuments.get(button.dataset.filePath);
    if (draft) {
      button.querySelector('.post-title').textContent = titleFromFrontMatter(draft.content) || button.dataset.postPath;
      button.querySelector('.post-entry-draft').classList.toggle('hidden', !draftFromFrontMatter(draft.content));
    }
    const draftSuffix = button.querySelector('.post-entry-draft').classList.contains('hidden') ? '' : ' (draft)';
    button.title = `${button.querySelector('.post-title').textContent}${draftSuffix} — ${button.dataset.postPath}`;
  }
  filterPosts();
}
function filterPosts() {
  const query = document.getElementById('post-search').value.trim().toLocaleLowerCase();
  let visible = 0;
  for (const button of postListEl.querySelectorAll('.post-entry')) {
    const searchableText = `${button.querySelector('.post-title').textContent} ${button.dataset.postPath}`;
    button.hidden = !searchableText.toLocaleLowerCase().includes(query);
    if (!button.hidden) visible++;
  }
  let empty = document.getElementById('post-search-empty');
  if (!empty) {
    empty = document.createElement('p'); empty.id = 'post-search-empty';
    empty.className = 'field-help'; empty.setAttribute('role', 'status'); postListEl.append(empty);
  }
  empty.textContent = !visible && query ? 'No matching posts.' : '';
}
document.getElementById('post-search').addEventListener('input', filterPosts);
let directoryEdited = false;
function updatePostLocation() {
  document.getElementById('new-post-location').textContent = `${hugoProjectPath}/content/posts/${newPostName.value || '…'}/index.md`;
}
document.getElementById('new-post-heading').addEventListener('input', event => {
  if (!directoryEdited) newPostName.value = suggestPostDirectory(event.target.value);
  updatePostLocation();
});
newPostName.addEventListener('input', () => { directoryEdited = Boolean(newPostName.value); updatePostLocation(); });

let selectedImagePath = null;
let imageContext = null;
const imageDialog = document.getElementById('insert-image-dialog');
function promptImage(filePath) {
  if (!filePath || windowCloseInProgress) return;
  if (!currentFilePath) { setStatus('Save your draft before inserting an image.', true); return; }
  selectedImagePath = filePath;
  imageContext = { key: currentDocumentKey, filePath: currentFilePath, content: editor.getValue(), position: editor.getSelection().from };
  document.getElementById('image-selected-name').textContent = filePath.split('/').pop();
  document.getElementById('image-alt').value = '';
  imageDialog.classList.remove('hidden');
  document.getElementById('image-alt').focus();
}
function closeImageDialog() { imageDialog.classList.add('hidden'); selectedImagePath = null; editor.focus(); }
document.getElementById('insert-image').addEventListener('click', async () => {
  if (!currentFilePath) {
    if (!(await saveCurrent(true))) return;
  }
  promptImage(await window.api.chooseImage());
});
document.getElementById('cancel-insert-image').addEventListener('click', closeImageDialog);
document.getElementById('insert-image-form').addEventListener('submit', event => {
  event.preventDefault();
  const filePath = selectedImagePath;
  const alt = document.getElementById('image-alt').value;
  const context = imageContext;
  closeImageDialog();
  if (filePath) handleImageFile(filePath, alt, context);
});
function updateImageProgress() {
  const progress = document.getElementById('image-progress');
  progress.classList.toggle('hidden', pendingImages.size === 0);
  progress.textContent = `Processing ${pendingImages.size} image${pendingImages.size === 1 ? '' : 's'}…`;
}

const scroller = editorHost.querySelector('.cm-scroller');
let scrollSource = null;
let scrollRelease;
function contentScrollAnchors() {
  if (!previewScrollTargets.length) return [];

  const editorMaximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const previewMaximum = Math.max(0, preview.scrollHeight - preview.clientHeight);
  const previewOrigin = previewScrollTargets[0].element.offsetTop;
  const anchors = previewScrollTargets.map(({ element, sourceLine }) => ({
    editor: Math.min(editorMaximum, editor.scrollTopForLine(sourceLine)),
    preview: Math.min(previewMaximum, Math.max(0, element.offsetTop - previewOrigin))
  }));

  const last = anchors.at(-1);
  if (!last || last.editor < editorMaximum || last.preview < previewMaximum) {
    anchors.push({ editor: editorMaximum, preview: previewMaximum });
  }
  return anchors;
}

function syncScroll(source, target) {
  if (!savedConfig.syncScroll || !previewVisible || (scrollSource && scrollSource !== source)) return;
  scrollSource = source;
  const anchors = contentScrollAnchors();
  if (anchors.length) {
    const editorIsSource = source === scroller;
    target.scrollTop = mappedScrollTop(
      source.scrollTop,
      anchors,
      editorIsSource ? 'editor' : 'preview',
      editorIsSource ? 'preview' : 'editor'
    );
  } else {
    target.scrollTop = scrollFraction(source) * Math.max(0, target.scrollHeight - target.clientHeight);
  }
  clearTimeout(scrollRelease);
  scrollRelease = setTimeout(() => { scrollSource = null; }, 100);
}
scroller.addEventListener('scroll', () => syncScroll(scroller, preview), { passive: true });
preview.addEventListener('scroll', () => syncScroll(preview, scroller), { passive: true });
preview.addEventListener('load', () => syncScroll(scroller, preview), true);
function updateSyncToggle() {
  const enabled = savedConfig.syncScroll === true;
  const button = document.getElementById('sync-scroll');
  button.setAttribute('aria-pressed', String(enabled));
  button.title = enabled ? 'Disable synchronized scrolling' : 'Enable synchronized scrolling';
}
document.getElementById('sync-scroll').addEventListener('click', async () => {
  savedConfig.syncScroll = !savedConfig.syncScroll;
  updateSyncToggle();
  syncScroll(scroller, preview);
  try { await window.api.saveConfig({ syncScroll: savedConfig.syncScroll }); }
  catch { setStatus('Scroll preference could not be saved', true); }
});

// Keep modal keyboard focus inside the active dialog and restore the invoking control.
const modalFocus = new Map();
for (const modal of document.querySelectorAll('[aria-modal="true"]')) {
  new MutationObserver(() => {
    if (modal.classList.contains('hidden')) {
      const trigger = modalFocus.get(modal);
      if (trigger?.getClientRects().length) trigger.focus();
      else if (trigger === imageOptionsBtn) document.getElementById('settings-button').focus();
      modalFocus.delete(modal);
    }
  }).observe(modal, { attributes: true, attributeFilter: ['class'] });
}
document.addEventListener('click', event => {
  for (const modal of document.querySelectorAll('[aria-modal="true"].hidden')) modalFocus.set(modal, event.target.closest('button') || document.activeElement);
}, true);
document.addEventListener('keydown', event => {
  const modal = document.querySelector('[aria-modal="true"]:not(.hidden)');
  if (!modal) return;
  if (event.key === 'Escape' && modal === imageDialog) { event.preventDefault(); closeImageDialog(); }
  if (event.key === 'Escape' && modal === featuredImageDialog) { event.preventDefault(); closeFeaturedImageDialog(); }
  if (event.key === 'Tab') {
    const controls = [...modal.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
  }
  if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'k', 's'].includes(event.key.toLowerCase())) event.stopImmediatePropagation();
}, true);


// Native popovers handle outside clicks, Escape, and returning focus to the trigger.
for (const [popoverId, triggerId] of [['settings-popover', 'settings-button'], ['format-popover', 'more-format']]) {
  const popover = document.getElementById(popoverId);
  const trigger = document.getElementById(triggerId);
  popover.addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const anchor = trigger.getBoundingClientRect();
    popover.style.top = `${anchor.bottom + 8}px`;
    popover.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - 272))}px`;
  });
}
document.getElementById('format-popover').addEventListener('click', event => {
  const button = event.target.closest('button[data-format]');
  if (!button) return;
  document.getElementById('format-popover').hidePopover();
  applyFormat(button.dataset.format);
});
imageOptionsBtn.addEventListener('click', () => document.getElementById('settings-popover').hidePopover());


// Keep every formatting action visible until its actual width no longer fits.
const overflowFormats = [...document.querySelectorAll('#format-popover [data-format]')];
const moreFormatButton = document.getElementById('more-format');
const formatPopover = document.getElementById('format-popover');
function layoutFormatToolbar() {
  if (!formatToolbar.getClientRects().length) return;
  const focused = document.activeElement;
  for (const button of overflowFormats) formatToolbar.insertBefore(button, moreFormatButton);
  moreFormatButton.hidden = false;
  const styles = getComputedStyle(formatToolbar);
  const available = formatToolbar.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  const gap = parseFloat(styles.columnGap) || 0;
  const fits = (withMore) => {
    const controls = [...formatToolbar.children].filter(el => withMore || el !== moreFormatButton);
    return controls.reduce((width, el) => width + el.getBoundingClientRect().width, 0) + gap * (controls.length - 1) <= available;
  };
  if (fits(false)) {
    moreFormatButton.hidden = true;
    if (formatPopover.matches(':popover-open')) formatPopover.hidePopover();
  } else {
    for (const button of [...overflowFormats].reverse()) {
      if (fits(true)) break;
      formatPopover.prepend(button);
    }
  }
  if (focused && overflowFormats.includes(focused) && focused.parentElement === formatPopover && !formatPopover.matches(':popover-open')) moreFormatButton.focus();
}
new ResizeObserver(layoutFormatToolbar).observe(formatToolbar);
layoutFormatToolbar();
updateHeader();
