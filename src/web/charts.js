// Line charts drawn as SVG at the size of their box (redrawn when it resizes), so text stays a
// readable size on a phone. Legends live in the HTML beside them.

import { clear, svg } from './dom.js';

function ticks(min, max, count) {
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/**
 * spec: { x: {min, max, label, format}, y: {min, max, label, format}, series: [{points: [[x, y]], cls}],
 *         marks: [{x, cls}] (vertical lines), height }
 */
export function lineChart(box, spec) {
  const draw = () => {
    const width = Math.max(260, Math.floor(box.clientWidth));
    const height = spec.height ?? Math.round(Math.min(320, Math.max(200, width * 0.5)));
    const m = { left: 48, right: 14, top: 12, bottom: 44 };
    const W = width - m.left - m.right;
    const H = height - m.top - m.bottom;
    const X = (v) => m.left + ((v - spec.x.min) / (spec.x.max - spec.x.min)) * W;
    const Y = (v) => m.top + H - ((v - spec.y.min) / (spec.y.max - spec.y.min)) * H;
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': spec.label ?? 'Chart', class: 'chart' });
    const xt = ticks(spec.x.min, spec.x.max, width < 420 ? 4 : 7);
    const yt = ticks(spec.y.min, spec.y.max, 4);
    for (const v of yt) {
      root.append(svg('line', { x1: m.left, x2: m.left + W, y1: Y(v), y2: Y(v), class: 'grid' }));
      root.append(svg('text', { x: m.left - 8, y: Y(v) + 4, 'text-anchor': 'end', class: 'tick', text: spec.y.format ? spec.y.format(v) : String(v) }));
    }
    for (const v of xt) {
      root.append(svg('line', { x1: X(v), x2: X(v), y1: m.top + H, y2: m.top + H + 5, class: 'axis' }));
      root.append(svg('text', { x: X(v), y: m.top + H + 19, 'text-anchor': 'middle', class: 'tick', text: spec.x.format ? spec.x.format(v) : String(v) }));
    }
    root.append(svg('line', { x1: m.left, x2: m.left + W, y1: m.top + H, y2: m.top + H, class: 'axis' }));
    root.append(svg('text', { x: m.left + W / 2, y: height - 6, 'text-anchor': 'middle', class: 'label', text: spec.x.label }));
    for (const mk of spec.marks ?? []) {
      if (mk.x < spec.x.min || mk.x > spec.x.max) continue;
      root.append(svg('line', { x1: X(mk.x), x2: X(mk.x), y1: m.top, y2: m.top + H, class: `mark ${mk.cls ?? ''}` }));
    }
    for (const s of spec.series) {
      const pts = s.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
      if (!pts.length) continue;
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(Math.min(spec.y.max, Math.max(spec.y.min, y))).toFixed(1)}`).join('');
      root.append(svg('path', { d, class: `line ${s.cls ?? ''}` }));
      for (const [x, y] of s.dots ?? []) root.append(svg('circle', { cx: X(x), cy: Y(y), r: 3, class: `dot ${s.cls ?? ''}` }));
    }
    clear(box).append(root);
  };
  draw();
  if (!box._observer) {
    let last = box.clientWidth;
    box._observer = new ResizeObserver(() => {
      if (Math.abs(box.clientWidth - last) < 2) return;
      last = box.clientWidth;
      box._redraw?.();
    });
    box._observer.observe(box);
  }
  box._redraw = draw;
}

/** A seismograph strip: one acceleration trace, drawn up to frame `upto`. */
export function seismograph(box, ax, upto, peak) {
  const width = Math.max(200, Math.floor(box.clientWidth));
  const height = 64;
  const n = ax.length;
  const scale = peak > 0 ? (height / 2 - 4) / peak : 1;
  let d = '';
  const last = Math.min(n - 1, upto);
  for (let i = 0; i <= last; i++) d += `${i ? 'L' : 'M'}${((i / (n - 1)) * width).toFixed(1)},${(height / 2 - ax[i] * scale).toFixed(1)}`;
  const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'seismo', 'aria-hidden': 'true' },
    svg('line', { x1: 0, x2: width, y1: height / 2, y2: height / 2, class: 'zero' }),
    d ? svg('path', { d, class: 'trace' }) : null);
  clear(box).append(root);
}
