import { SearchQuery, getSearchQuery, setSearchQuery, findNext, findPrevious, replaceNext, replaceAll, closeSearchPanel } from '@codemirror/search';
import { runScopeHandlers } from '@codemirror/view';

export function createSearchPanel(view) {
  const dom = document.createElement('div');
  dom.className = 'cm-search editor-search';
  dom.setAttribute('role', 'search');
  dom.setAttribute('aria-label', 'Find and replace in document');
  const row = document.createElement('div');
  row.className = 'search-row';
  const replacement = document.createElement('div');
  replacement.className = 'search-row search-replacement';
  replacement.hidden = true;
  const options = document.createElement('div');
  options.className = 'search-options';
  const button = (name, text, label, action) => {
    const el = document.createElement('button');
    el.type = 'button'; el.name = name; el.textContent = text;
    el.title = label; el.setAttribute('aria-label', label);
    el.addEventListener('click', action);
    return el;
  };
  const input = (name, placeholder) => {
    const el = document.createElement('input');
    el.name = name; el.placeholder = placeholder;
    el.setAttribute('aria-label', placeholder);
    el.autocomplete = 'off'; el.spellcheck = false;
    el.addEventListener('input', commit);
    return el;
  };
  const find = input('search', 'Find in document');
  find.setAttribute('main-field', 'true');
  const replace = input('replace', 'Replace with');
  const toggle = button('toggleReplace', '›', 'Show replacement controls', () => {
    replacement.hidden = !replacement.hidden;
    toggle.textContent = replacement.hidden ? '›' : '⌄';
    toggle.setAttribute('aria-expanded', String(!replacement.hidden));
    toggle.title = replacement.hidden ? 'Show replacement controls' : 'Hide replacement controls';
    toggle.setAttribute('aria-label', toggle.title);
    if (!replacement.hidden) replace.focus();
    view.requestMeasure();
  });
  toggle.setAttribute('aria-expanded', 'false');
  const previous = button('prev', '↑', 'Previous match (Shift+Enter)', () => findPrevious(view));
  const next = button('next', '↓', 'Next match (Enter)', () => findNext(view));
  const close = button('close', '×', 'Close search (Escape)', () => closeSearchPanel(view));
  const one = button('replace', 'Replace', 'Replace current match', () => replaceNext(view));
  const all = button('replaceAll', 'Replace all', 'Replace all matches in this document', () => replaceAll(view));
  const count = document.createElement('span');
  count.className = 'search-count'; count.setAttribute('role', 'status');
  const toggles = {};
  for (const [name, text, label, property] of [
    ['case', 'Aa', 'Match case', 'caseSensitive'],
    ['word', 'ab', 'Whole word', 'wholeWord'],
    ['re', '.*', 'Regular expression', 'regexp']
  ]) {
    const el = button(name, text, label, () => {
      el.setAttribute('aria-pressed', String(el.getAttribute('aria-pressed') !== 'true'));
      commit();
    });
    toggles[property] = el;
    options.append(el);
  }
  options.append(count);
  row.append(toggle, find, previous, next, close);
  replacement.append(replace, one, all);
  dom.append(row, options, replacement);

  function commit() {
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({
      search: find.value, replace: replace.value,
      ...Object.fromEntries(Object.entries(toggles).map(([key, el]) => [key, el.getAttribute('aria-pressed') === 'true']))
    })) });
  }
  function update() {
    const query = getSearchQuery(view.state);
    find.value = query.search; replace.value = query.replace;
    for (const [key, el] of Object.entries(toggles)) el.setAttribute('aria-pressed', String(query[key]));
    let total = 0, current = 0;
    if (query.valid) {
      const cursor = query.getCursor(view.state);
      for (let match = cursor.next(); !match.done; match = cursor.next()) {
        total++;
        if (match.value.from === view.state.selection.main.from && match.value.to === view.state.selection.main.to) current = total;
        if (total > 10000) break;
      }
    }
    count.textContent = !query.search ? '' : !query.valid ? 'Invalid expression' : !total ? 'No matches' : total > 10000 ? '10,000+ matches' : current ? `${current} of ${total}` : `${total} match${total === 1 ? '' : 'es'}`;
    find.setAttribute('aria-invalid', String(Boolean(query.search && !query.valid)));
    for (const el of [previous, next, one, all]) el.disabled = !total;
  }
  dom.addEventListener('keydown', event => {
    if (runScopeHandlers(view, event, 'search-panel')) event.preventDefault();
    else if (event.key === 'Enter' && !event.isComposing && (event.target === find || event.target === replace)) {
      event.preventDefault();
      if (event.target === find) (event.shiftKey ? findPrevious : findNext)(view);
      else if (event.target === replace) replaceNext(view);
    }
  });
  update();
  return { dom, top: true, update, mount: () => find.select() };
}
