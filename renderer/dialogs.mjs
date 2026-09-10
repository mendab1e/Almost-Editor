export function showDialog(dialog, focusTarget) {
  dialog.classList.remove('hidden');
  focusTarget?.focus();
}

// Form-specific cleanup stays with each form; dismissal and focus behavior are shared.
export function bindDialogs(entries, { document, fallbackFocus }) {
  const triggers = new Map();
  for (const { dialog, cancel, close } of entries) {
    cancel.addEventListener('click', close);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) close();
    });
    new MutationObserver(() => {
      if (!dialog.classList.contains('hidden')) return;
      const trigger = triggers.get(dialog);
      if (trigger?.getClientRects().length) trigger.focus();
      else if (trigger) fallbackFocus(trigger)?.focus();
      triggers.delete(dialog);
    }).observe(dialog, { attributes: true, attributeFilter: ['class'] });
  }
  document.addEventListener('click', event => {
    for (const { dialog } of entries) {
      if (dialog.classList.contains('hidden')) {
        triggers.set(dialog, event.target.closest('button') || document.activeElement);
      }
    }
  }, true);
  document.addEventListener('keydown', event => {
    const entry = entries.find(({ dialog }) => !dialog.classList.contains('hidden'));
    if (!entry) return;
    const { dialog, close } = entry;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
        .filter(el => !el.disabled && el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first?.focus();
      }
    }
    if ((event.metaKey || event.ctrlKey) && ['b', 'i', 'k', 's'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
}
