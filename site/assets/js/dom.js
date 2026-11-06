// Small DOM helpers. Everything is built with createElement and textContent: no HTML strings.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
}

export function svg(tag, attrs = {}, ...children) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, String(v));
  }
  for (const c of children) if (c) n.append(c);
  return n;
}

export function $(sel, root = document) {
  const n = root.querySelector(sel);
  if (!n) throw new Error(`missing ${sel}`);
  return n;
}

export function clear(n) {
  while (n.firstChild) n.firstChild.remove();
  return n;
}

export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A worker that answers one request at a time, matched by id. */
export function simulator() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  let next = 1;
  const waiting = new Map();
  worker.onmessage = (ev) => {
    const w = waiting.get(ev.data.id);
    if (!w) return;
    waiting.delete(ev.data.id);
    if (ev.data.ok) w.resolve(ev.data);
    else w.reject(new Error(ev.data.error));
  };
  return {
    run(request) {
      const id = next++;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        worker.postMessage({ ...request, id, type: 'room' });
      });
    },
  };
}

export async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('a file could not be loaded');
  return res.json();
}

/** Saves text as a file, without leaving the page. */
export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const fmt = {
  g: (v) => `${v.toFixed(v < 0.1 ? 2 : 2)} g`,
  m: (v) => `${v.toFixed(2)} m`,
};
