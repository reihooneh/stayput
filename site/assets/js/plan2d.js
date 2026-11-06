// The floor plan: the room from above, the places people spend time, each piece of furniture
// (draggable, or moved with the arrow keys), and where it would land if it fell.

import { clear, svg } from './dom.js';
import { footprint, facing, landing } from './model.js';

const PAD = 28;

export class PlanView {
  constructor(box, { onSelect, onMove } = {}) {
    this.box = box;
    this.onSelect = onSelect;
    this.onMove = onMove;
    this.room = null;
    this.selected = null;
    this.risk = {};
    this.resize = new ResizeObserver(() => {
      if (Math.abs(box.clientWidth - (this.lastWidth ?? 0)) >= 2) this.draw();
    });
    this.resize.observe(box);
  }

  set(room, risk = {}) {
    this.room = room;
    this.risk = risk;
    this.draw();
  }

  select(id) {
    this.selected = id;
    this.draw();
  }

  draw() {
    const room = this.room;
    if (!room) return;
    const width = Math.max(260, Math.floor(this.box.clientWidth));
    this.lastWidth = width;
    const s = (width - 2 * PAD) / room.width;
    const height = Math.round(room.depth * s + 2 * PAD);
    const X = (v) => PAD + v * s;
    const Y = (v) => PAD + v * s;
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, class: 'plan', role: 'group', 'aria-label': `Floor plan of ${room.name}, ${room.width} by ${room.depth} metres` });
    root.append(svg('rect', { x: X(0), y: Y(0), width: room.width * s, height: room.depth * s, class: 'room' }));
    for (let v = 0.5; v < room.width; v += 0.5) root.append(svg('line', { x1: X(v), x2: X(v), y1: Y(0), y2: Y(room.depth), class: 'grid' }));
    for (let v = 0.5; v < room.depth; v += 0.5) root.append(svg('line', { x1: X(0), x2: X(room.width), y1: Y(v), y2: Y(v), class: 'grid' }));
    // The two walls the 3D view draws: back (top of the plan) and left.
    root.append(svg('line', { x1: X(0), x2: X(room.width), y1: Y(0), y2: Y(0), class: 'wall' }));
    root.append(svg('line', { x1: X(0), x2: X(0), y1: Y(0), y2: Y(room.depth), class: 'wall' }));
    for (const z of room.zones) {
      root.append(svg('rect', { x: X(z.x), y: Y(z.y), width: z.width * s, height: z.depth * s, class: `zone zone-${z.kind}` }));
    }
    // Where things land, under the furniture, shaded by the chance.
    for (const it of room.items) {
      const r = this.risk[it.id];
      if (!r || r.chance < 0.02) continue;
      for (const [fw, share] of [[true, r.forwardShare], [false, 1 - r.forwardShare]]) {
        if (share < 0.05) continue;
        const land = landing(it, room, fw);
        if (!land) continue;
        const o = Math.min(0.55, 0.12 + 0.5 * r.chance * share);
        root.append(svg('rect', { x: X(land.x), y: Y(land.y), width: land.width * s, height: land.depth * s, class: 'landing', 'fill-opacity': o.toFixed(2) }));
      }
    }
    for (const z of room.zones) {
      const fs = Math.min(14, Math.max(11, z.depth * s * 0.3));
      if (z.width * s > 34 && z.depth * s > 18) {
        root.append(svg('text', { x: X(z.x) + 6, y: Y(z.y) + fs + 3, class: 'zone-label', 'font-size': fs, text: z.name.length * fs * 0.55 < z.width * s - 10 ? z.name : z.name.slice(0, 1) }));
      }
    }
    room.items.forEach((it, i) => {
      const f = footprint(it);
      const dir = facing(it.rotation);
      const g = svg('g', { class: `item${it.id === this.selected ? ' selected' : ''}${it.anchored ? ' anchored' : ''}`, tabindex: 0, role: 'button', 'aria-label': `${it.name}: drag or use the arrow keys to move, R to turn`, 'data-id': it.id });
      g.append(svg('rect', { x: X(f.x), y: Y(f.y), width: f.width * s, height: f.depth * s, class: 'body' }));
      // The front edge, thicker: the way it faces and usually falls.
      const fx0 = dir.x === 0 ? X(f.x) : X(dir.x > 0 ? f.x + f.width : f.x);
      const fy0 = dir.y === 0 ? Y(f.y) : Y(dir.y > 0 ? f.y + f.depth : f.y);
      const fx1 = dir.x === 0 ? X(f.x + f.width) : fx0;
      const fy1 = dir.y === 0 ? Y(f.y + f.depth) : fy0;
      g.append(svg('line', { x1: fx0, y1: fy0, x2: fx1, y2: fy1, class: 'front' }));
      const cx = X(it.x);
      const cy = Y(it.y);
      g.append(svg('circle', { cx, cy, r: 10, class: 'badge' }));
      g.append(svg('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'badge-text', text: String(i + 1) }));
      this.bind(g, it, s);
      root.append(g);
    });
    root.append(svg('line', { x1: X(0), x2: X(1), y1: height - 9, y2: height - 9, class: 'scale' }));
    root.append(svg('text', { x: X(1) + 6, y: height - 5, class: 'scale-text', text: '1 m' }));
    clear(this.box).append(root);
    if (this.focusId) {
      root.querySelector(`[data-id="${CSS.escape(this.focusId)}"]`)?.focus();
      this.focusId = null;
    }
  }

  bind(g, it, s) {
    let start = null;
    g.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      g.setPointerCapture(ev.pointerId);
      start = { x: ev.clientX, y: ev.clientY, ix: it.x, iy: it.y, moved: false };
      this.onSelect?.(it.id);
    });
    g.addEventListener('pointermove', (ev) => {
      if (!start) return;
      const dx = (ev.clientX - start.x) / s;
      const dy = (ev.clientY - start.y) / s;
      if (Math.abs(dx) + Math.abs(dy) < 0.02) return;
      start.moved = true;
      this.onMove?.(it.id, start.ix + dx, start.iy + dy, false);
    });
    const end = () => {
      if (start?.moved) this.onMove?.(it.id, it.x, it.y, true);
      start = null;
    };
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
    g.addEventListener('keydown', (ev) => {
      const step = ev.shiftKey ? 0.25 : 0.05;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[ev.key]) {
        ev.preventDefault();
        this.focusId = it.id;
        this.onMove?.(it.id, it.x + moves[ev.key][0], it.y + moves[ev.key][1], true);
      } else if (ev.key === 'r' || ev.key === 'R') {
        ev.preventDefault();
        this.focusId = it.id;
        this.onMove?.(it.id, it.x, it.y, true, true);
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        this.onSelect?.(it.id);
      }
    });
  }
}
