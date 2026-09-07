export { sanitizePreview } from './preview-security.js';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { Decoration, EditorView, keymap, lineNumbers, ViewPlugin } from '@codemirror/view';
import { tags } from '@lezer/highlight';

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
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
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
    getSelection() {
      const range = view.state.selection.main;
      return { from: range.from, to: range.to, text: view.state.sliceDoc(range.from, range.to) };
    },
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
