export { sanitizePreview } from './preview-security.js';
export { renderMarkdownPreview } from './preview-rendering.mjs';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import {
  findNext,
  findPrevious,
  openSearchPanel,
  search,
  searchKeymap
} from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, keymap, lineNumbers, ViewPlugin } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { createSearchPanel } from './search-panel.mjs';

const lightHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.heading, color: '#7c3aed', fontWeight: '700' },
  { tag: tags.emphasis, color: '#b45309', fontStyle: 'italic' },
  { tag: tags.strong, color: '#b45309', fontWeight: '700' },
  { tag: tags.link, color: '#2563eb' },
  { tag: tags.url, color: '#2563eb' },
  { tag: tags.monospace, color: '#b42318' },
  { tag: tags.quote, color: '#667085' },
  { tag: tags.comment, color: '#667085' },
  { tag: tags.keyword, color: '#9d174d' },
  { tag: tags.string, color: '#0f766e' },
  { tag: tags.number, color: '#9a3412' }
]));

const lightTheme = [
  EditorView.theme({
    '&': { height: '100%', color: '#1f2937', backgroundColor: '#ffffff' },
    // CodeMirror positions gutter entries relative to the document. Adding
    // matching content padding here shifts every line number down one line.
    '.cm-gutters': { border: 'none', color: '#98a2b3', backgroundColor: '#ffffff' },
    '.cm-activeLine': { backgroundColor: '#f8fafc' },
    '.cm-activeLineGutter': { backgroundColor: '#f8fafc' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: '#c7d7fe' }
  }),
  lightHighlighting
];

// Keep the editing geometry identical across themes. oneDark supplies its own
// colors, but without these overrides it falls back to different typography.
function editorTypography(fontSize) {
  return EditorView.theme({
    '&': { height: '100%' },
    '.cm-scroller': {
      fontFamily: '"SF Mono", Menlo, monospace',
      fontSize: `${fontSize}px`,
      lineHeight: '1.6',
      fontWeight: '400',
      letterSpacing: 'normal'
    },
    '.cm-content': { padding: '24px 6%' },
    '.cm-gutters': { paddingTop: '0' }
  });
}

function shortcodeDecorations(view) {
  const ranges = [];
  const shortcodes = /\{\{<[\s\S]*?>\}\}/g;
  const text = view.state.doc.toString();
  let match;
  while ((match = shortcodes.exec(text))) {
    ranges.push(Decoration.mark({ class: 'cm-hugo-shortcode' }).range(match.index, match.index + match[0].length));
  }
  return Decoration.set(ranges, true);
}

const hugoShortcodeHighlighting = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = shortcodeDecorations(view);
  }

  update(update) {
    if (update.docChanged) this.decorations = shortcodeDecorations(update.view);
  }
}, {
  decorations: (plugin) => plugin.decorations
});

const shortcodeTheme = EditorView.baseTheme({
  '.cm-hugo-shortcode': { color: '#c2410c', backgroundColor: '#fff7ed', borderRadius: '3px' },
  '.cm-editor.cm-dark .cm-hugo-shortcode': { color: '#fdba74', backgroundColor: '#431407' }
});

const searchTheme = EditorView.baseTheme({
  '.cm-panel.cm-search': {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 38px 8px 12px',
    borderBottom: '1px solid var(--border)',
    backgroundColor: 'var(--preview-bg)',
    color: 'var(--text)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    fontSize: '12px'
  },
  '.cm-panel.cm-search br': { flexBasis: '100%', width: '100%', height: '0' },
  '.cm-panel.cm-search .cm-textfield': {
    flex: '1 1 150px',
    minWidth: '110px',
    height: '30px',
    margin: '0',
    padding: '5px 8px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--control-radius)',
    backgroundColor: 'var(--app-bg)',
    color: 'var(--text)',
    font: 'inherit'
  },
  '.cm-panel.cm-search .cm-button': {
    minHeight: '30px',
    margin: '0',
    padding: '5px 9px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--control-radius)',
    backgroundColor: 'var(--control-bg)',
    backgroundImage: 'none',
    color: 'var(--text)',
    font: 'inherit',
    cursor: 'pointer'
  },
  '.cm-panel.cm-search .cm-button:hover': { backgroundColor: 'var(--control-hover)' },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    margin: '0',
    color: 'var(--muted)',
    fontSize: '11px'
  },
  '.cm-panel.cm-search label input': { margin: '0' },
  '.cm-panel.cm-search [name=close]': {
    top: '8px',
    right: '10px',
    width: '24px',
    height: '24px',
    minHeight: '24px',
    borderRadius: '4px',
    color: 'var(--muted)',
    cursor: 'pointer'
  },
  '.cm-panel.cm-search [name=close]:hover': {
    backgroundColor: 'var(--control-hover)',
    color: 'var(--text)'
  },
  '&light .cm-searchMatch, &dark .cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' },
  '&light .cm-searchMatch-selected, &dark .cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, #f79009 45%, transparent)' }
});

export function createMarkdownEditor(parent, onChange) {
  const theme = new Compartment();
  const fontSize = new Compartment();
  let currentTheme = 'light';
  let currentFontSize = 15;
  const createState = (doc) => EditorState.create({
    doc,
    extensions: [
      history(),
      lineNumbers(),
      markdown(),
      hugoShortcodeHighlighting,
      shortcodeTheme,
      search({ top: true, createPanel: createSearchPanel }),
      searchTheme,
      keymap.of([...searchKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
      theme.of(currentTheme === 'dark' ? oneDark : lightTheme),
      fontSize.of(editorTypography(currentFontSize))
    ]
  });
  const view = new EditorView({ state: createState(''), parent });

  function getValue() {
    return view.state.doc.toString();
  }

  function setValue(value) {
    view.setState(createState(value));
  }

  return {
    getValue,
    setValue,
    scrollTopForLine(lineNumber) {
      const number = Math.max(1, Math.min(view.state.doc.lines, lineNumber));
      const line = view.state.doc.line(number);
      return view.documentPadding.top + view.lineBlockAt(line.from).top;
    },
    getSelection() {
      const range = view.state.selection.main;
      return { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
    },
    openSearch: () => openSearchPanel(view),
    findNext: () => findNext(view),
    findPrevious: () => findPrevious(view),
    focus: () => view.focus(),
    setTheme(mode) {
      currentTheme = mode;
      view.dispatch({ effects: theme.reconfigure(mode === 'dark' ? oneDark : lightTheme) });
    },
    setFontSize(size) {
      currentFontSize = size;
      view.dispatch({ effects: fontSize.reconfigure(editorTypography(size)) });
    },
    insertAtCursor(text) {
      const range = view.state.selection.main;
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: text },
        selection: { anchor: range.from + text.length }
      });
      view.focus();
    },
    replaceRange(from, to, text, selectionStart = from + text.length, selectionEnd = selectionStart) {
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: selectionStart, head: selectionEnd }
      });
      view.focus();
    },
    onPaste: (listener) => view.contentDOM.addEventListener('paste', listener)
  };
}
