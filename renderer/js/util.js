export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${new URL(src).hostname}`));
    document.head.appendChild(s);
  });
}

export function formatTime(ms) {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatTotal(ms) {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} hr ${min % 60} min`;
}

export const uid = () => crypto.randomUUID();

// Tiny element builder: h('div#id.cls', { onclick }, child, 'text')
export function h(tag, props, ...children) {
  const parts = tag.split(/(?=[.#])/);
  const name = parts[0].startsWith('.') || parts[0].startsWith('#') ? 'div' : parts.shift();
  const el = document.createElement(name);
  const classes = parts.filter((p) => p[0] === '.').map((p) => p.slice(1));
  const id = parts.find((p) => p[0] === '#');
  if (classes.length) el.className = classes.join(' ');
  if (id) el.id = id.slice(1);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ' ' + v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v; // only used with static icon SVG
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Run async fn over items with limited concurrency, preserving order.
export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class Emitter {
  constructor() { this.handlers = {}; }
  on(evt, fn) { (this.handlers[evt] ||= []).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { this.handlers[evt] = (this.handlers[evt] || []).filter((f) => f !== fn); }
  emit(evt, ...args) { for (const fn of this.handlers[evt] || []) fn(...args); }
}
