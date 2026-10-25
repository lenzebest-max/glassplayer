import { h } from './util.js';
import { icon } from './icons.js';

export function toast(message, type = '', ms = 3800) {
  const el = h(`div.toast${type ? '.' + type : ''}`, String(message));
  document.getElementById('toasts').append(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export const toastError = (err) => {
  console.error(err);
  toast(err && err.message ? err.message : String(err), 'error', 5500);
};

let openModals = 0;
export const modalOpen = () => openModals > 0;

export function modal({ title, body, foot, size = '', onClose, headExtra }) {
  const root = document.getElementById('modal-root');
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    openModals--;
    document.removeEventListener('keydown', onKey, true);
    backdrop.remove();
    if (onClose) onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const dialog = h(`div.modal${size ? '.' + size : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div.modal-head', h('h2', title), headExtra, h('button.icon-btn.sm', { title: 'Close', html: icon('x', 18), onclick: close })),
    body,
    foot ? h('div.modal-foot', foot) : null,
  );
  const backdrop = h('div.modal-backdrop', { onmousedown: (e) => e.target === backdrop && close() }, dialog);
  root.append(backdrop);
  openModals++;
  document.addEventListener('keydown', onKey, true);
  const first = dialog.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, el: dialog };
}

export function confirmDialog(title, message, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({
      title,
      size: 'sm',
      body: h('div.modal-body', h('p', { style: { margin: 0, color: 'var(--text-2)', lineHeight: 1.5 } }, message)),
      foot: [
        h('button.pill', { onclick: () => m.close() }, 'Cancel'),
        h(`button.pill${danger ? '.danger' : '.primary'}`, { onclick: () => { result = true; m.close(); } }, okLabel),
      ],
      onClose: () => resolve(result),
    });
  });
}

export function promptDialog(title, label, value = '', okLabel = 'Save') {
  return new Promise((resolve) => {
    let result = null;
    const input = h('input.text-input', { value, onkeydown: (e) => e.key === 'Enter' && submit() });
    const submit = () => {
      if (!input.value.trim()) return input.focus();
      result = input.value.trim();
      m.close();
    };
    const m = modal({
      title,
      size: 'sm',
      body: h('div.modal-body', h('label.field', h('span', label), input)),
      foot: [h('button.pill', { onclick: () => m.close() }, 'Cancel'), h('button.pill.primary', { onclick: submit }, okLabel)],
      onClose: () => resolve(result),
    });
    setTimeout(() => input.select(), 40);
  });
}

let activeMenu = null;
export function closeMenu() {
  if (activeMenu) activeMenu.remove();
  activeMenu = null;
}

// items: { label, icon, onClick, danger } | '-' | { header: 'Text' }
export function menu(x, y, items) {
  closeMenu();
  const el = h('div.menu', { role: 'menu' },
    items.filter(Boolean).map((it) => {
      if (it === '-') return h('hr');
      if (it.header) return h('div.menu-label', it.header);
      return h(`button${it.danger ? '.danger' : ''}`, {
        role: 'menuitem',
        onclick: () => { closeMenu(); it.onClick(); },
      }, it.icon ? h('span', { html: icon(it.icon, 16), style: { display: 'flex' } }) : null, it.label);
    }),
  );
  document.getElementById('menu-root').append(el);
  const r = el.getBoundingClientRect();
  el.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  el.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  activeMenu = el;
  setTimeout(() => {
    const away = (e) => {
      if (!el.contains(e.target)) {
        closeMenu();
        document.removeEventListener('mousedown', away, true);
      }
    };
    document.addEventListener('mousedown', away, true);
  });
}

export function toggleRow({ label, hint, checked, onChange }) {
  const input = h('input', { type: 'checkbox', checked: Boolean(checked), onchange: (e) => onChange(e.target.checked) });
  return h('label.toggle', h('div.tl', h('b', label), hint ? h('small', hint) : null), input, h('span.switch'));
}

export function setRange(input, value, max) {
  input.max = max;
  input.value = value;
  input.style.setProperty('--p', `${max > 0 ? (value / max) * 100 : 0}%`);
}
