// The 3D room. Each piece of furniture pivots on its real front or back edge by the tilt the
// simulation computed, frame by frame, and the whole floor moves with the earthquake.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clear, el, reducedMotion } from './dom.js';
import { facing, restingTilt } from './model.js';

const WALL_H = 2.5;
const COLOURS = {
  bookcase: 0x8a5a3b,
  wardrobe: 0xc9b28f,
  dresser: 0x9c6b48,
  shelf: 0xb98b5f,
  tv: 0x3a3f47,
  fridge: 0xe8ebee,
  lamp: 0xd8c27a,
  cabinet: 0x7d5a44,
};

function webgl() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function box(w, h, d, colour, opts = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, ...opts }));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A piece of furniture in its own coordinates: floor at y = 0, front facing +z, centred. */
function furniture(it) {
  const g = new THREE.Group();
  const c = COLOURS[it.kind] ?? 0x999999;
  const { width: w, depth: d, height: h } = it;
  if (it.kind === 'lamp') {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, h * 0.85, 8), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    pole.position.y = h * 0.425;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.03, 20), new THREE.MeshStandardMaterial({ color: 0x444444 }));
    base.position.y = 0.015;
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.48, h * 0.18, 20, 1, true), new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, emissive: 0x3a2f10 }));
    shade.position.y = h * 0.9;
    for (const m of [pole, base, shade]) m.castShadow = true;
    g.add(pole, base, shade);
    return g;
  }
  if (it.kind === 'tv') {
    const stand = box(w, h * 0.45, d, c);
    stand.position.y = h * 0.225;
    const screen = box(w * 0.85, h * 0.5, 0.05, 0x15171a, { roughness: 0.3 });
    screen.position.set(0, h * 0.45 + h * 0.27, -d * 0.1);
    const foot = box(w * 0.3, 0.04, d * 0.5, 0x222222);
    foot.position.set(0, h * 0.45 + 0.02, -d * 0.1);
    g.add(stand, screen, foot);
    return g;
  }
  const open = it.kind === 'bookcase' || it.kind === 'shelf';
  if (open) {
    // An open frame: back, sides, top and bottom, so the books show.
    const t = 0.02;
    const parts = [
      [w, h, t, 0, h / 2, -d / 2 + t / 2],
      [t, h, d, -w / 2 + t / 2, h / 2, 0],
      [t, h, d, w / 2 - t / 2, h / 2, 0],
      [w, t, d, 0, h - t / 2, 0],
      [w, 0.06, d, 0, 0.03, 0],
    ];
    for (const [bw, bh, bd, x, y, z] of parts) {
      const m = box(bw, bh, bd, c);
      m.position.set(x, y, z);
      g.add(m);
    }
  } else {
    const body = box(w, h, d, c);
    body.position.y = h / 2;
    g.add(body);
  }
  const front = (ww, hh, y, x = 0, colour = 0x000000, opacity = 0.18) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(ww, hh), new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity }));
    p.position.set(x, y, d / 2 + 0.002);
    g.add(p);
  };
  if (it.kind === 'bookcase' || it.kind === 'shelf' || it.kind === 'cabinet') {
    const n = Math.max(3, Math.round(h / 0.38));
    const books = [0xa63d40, 0x2f5d8a, 0xe0b44c, 0x3c8c6e, 0x6b4e9b, 0xd98e5a];
    for (let i = 0; i < n; i++) {
      const y0 = 0.08 + (i * (h - 0.12)) / n;
      if (it.kind === 'cabinet') {
        front(w - 0.04, 0.02, y0, 0, 0x000000, 0.35);
        continue;
      }
      const shelfBoard = box(w - 0.04, 0.02, d - 0.02, c);
      shelfBoard.position.set(0, y0, 0.01);
      g.add(shelfBoard);
      let x = -w / 2 + 0.04;
      let k = i * 3;
      while (x < w / 2 - 0.08) {
        const bw = 0.025 + ((k * 37) % 5) * 0.008;
        const bh = ((h - 0.12) / n) * (0.5 + ((k * 13) % 4) * 0.08);
        const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d * 0.65), new THREE.MeshStandardMaterial({ color: books[k % books.length], roughness: 0.9 }));
        b.position.set(x + bw / 2, y0 + 0.01 + bh / 2, -d * 0.1);
        g.add(b);
        x += bw + 0.004;
        k++;
      }
    }
    if (it.kind === 'cabinet') front(w - 0.06, h - 0.1, h / 2, 0, 0xbfd8e8, 0.35);
  } else if (it.kind === 'wardrobe' || it.kind === 'fridge') {
    front(0.012, h - 0.1, h / 2, 0, 0x000000, 0.4);
    if (it.kind === 'fridge') front(w - 0.04, 0.012, h * 0.62, 0, 0x000000, 0.4);
  } else if (it.kind === 'dresser') {
    const n = 4;
    for (let i = 1; i < n; i++) front(w - 0.04, 0.012, (i * h) / n, 0, 0x000000, 0.4);
  }
  return g;
}

function zoneMesh(z) {
  const g = new THREE.Group();
  const cx = z.x + z.width / 2;
  const cz = z.y + z.depth / 2;
  if (z.kind === 'exit') {
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2c230, transparent: true, opacity: 0.55 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(z.width, z.depth), mat);
    p.rotation.x = -Math.PI / 2;
    p.position.set(cx, 0.004, cz);
    g.add(p);
    return g;
  }
  const spec = { bed: [0.45, 0xf0f2f5], cot: [0.75, 0xf3e3c3], desk: [0.74, 0xa8825e], sofa: [0.42, 0x5f7d8c] }[z.kind];
  const [h, colour] = spec;
  if (z.kind === 'desk') {
    const top = box(z.width, 0.04, z.depth, colour);
    top.position.set(cx, h, cz);
    g.add(top);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = box(0.04, h, 0.04, 0x6b5440);
      leg.position.set(cx + dx * (z.width / 2 - 0.05), h / 2, cz + dz * (z.depth / 2 - 0.05));
      g.add(leg);
    }
    return g;
  }
  const base = box(z.width, h, z.depth, colour);
  base.position.set(cx, h / 2, cz);
  g.add(base);
  if (z.kind === 'bed') {
    const pillow = box(Math.min(0.6, z.width * 0.4), 0.1, 0.35, 0xffffff);
    pillow.position.set(cx, h + 0.05, z.y + 0.3);
    const quilt = box(z.width + 0.02, 0.06, z.depth * 0.65, 0x2f5d8a);
    quilt.position.set(cx, h + 0.02, z.y + z.depth * 0.65);
    g.add(pillow, quilt);
  }
  return g;
}

export class RoomView {
  constructor(container, { orbit = true, caption = 'A 3D view of the room' } = {}) {
    this.container = container;
    this.items = new Map();
    this.anim = null;
    if (!webgl()) {
      container.dataset.mode = 'flat';
      clear(container).append(el('p', { class: 'flat-note', text: 'The 3D view needs WebGL, which this browser has turned off. Everything else on the page still works.' }));
      return;
    }
    container.dataset.mode = 'webgl';
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-label', caption);
    this.renderer.domElement.setAttribute('role', 'img');
    clear(container).append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xdfe5ea);
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.scene.add(new THREE.HemisphereLight(0xf4f7fa, 0x8a8f96, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, 7, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -6;
    sun.shadow.camera.right = 6;
    sun.shadow.camera.top = 6;
    sun.shadow.camera.bottom = -6;
    this.sun = sun;
    this.scene.add(sun, sun.target);
    this.floor = new THREE.Group();
    this.scene.add(this.floor);
    if (orbit) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = false;
      this.controls.enablePan = false;
      this.controls.minPolarAngle = 0.25;
      this.controls.maxPolarAngle = 1.35;
      this.controls.addEventListener('change', () => this.render());
    }
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(container);
  }

  get ok() {
    return !!this.renderer;
  }

  fit() {
    if (!this.ok) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  render() {
    if (this.ok) this.renderer.render(this.scene, this.camera);
  }

  setRoom(room) {
    if (!this.ok) return;
    this.room = room;
    this.floor.clear();
    this.items.clear();
    const W = room.width;
    const D = room.depth;
    const floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xc8b89c, roughness: 0.9 }));
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.set(W / 2, 0, D / 2);
    floorMesh.receiveShadow = true;
    this.floor.add(floorMesh);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9edf0, roughness: 1 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.1, WALL_H, 0.1), wallMat);
    back.position.set(W / 2 - 0.05, WALL_H / 2, -0.05);
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.1, WALL_H, D), wallMat);
    left.position.set(-0.05, WALL_H / 2, D / 2);
    back.receiveShadow = left.receiveShadow = true;
    this.floor.add(back, left);
    for (const z of room.zones) this.floor.add(zoneMesh(z));
    for (const it of room.items) {
      const yaw = new THREE.Group();
      const f = facing(it.rotation);
      yaw.position.set(it.x, 0, it.y);
      yaw.rotation.y = Math.atan2(f.x, f.y);
      const rock = new THREE.Group();
      const body = furniture(it);
      rock.add(body);
      yaw.add(rock);
      this.floor.add(yaw);
      this.items.set(it.id, { it, yaw, rock, body, f, base: { x: it.x, z: it.y }, stopF: restingTilt(it, room, true), stopB: restingTilt(it, room, false) });
    }
    const size = Math.max(W, D);
    this.camera.position.set(W * 0.5 + size * 0.95, size * 1.05, D * 0.5 + size * 1.35);
    const target = new THREE.Vector3(W / 2, 0.7, D / 2);
    this.camera.lookAt(target);
    if (this.controls) {
      this.controls.target.copy(target);
      this.controls.minDistance = size * 0.9;
      this.controls.maxDistance = size * 3;
      this.controls.update();
    }
    this.sun.target.position.copy(target);
    this.fit();
  }

  /** Sets one frame: tilt (radians, + forwards) and slide (m) for each item, and the floor's offset. */
  pose(states, offset = { x: 0, z: 0 }) {
    if (!this.ok) return;
    this.floor.position.set(offset.x, 0, offset.z);
    for (const [id, s] of Object.entries(states)) {
      const v = this.items.get(id);
      if (!v) continue;
      const half = v.it.depth / 2;
      const th = s.tilt >= 0 ? Math.min(s.tilt, v.stopF) : Math.max(s.tilt, -v.stopB);
      const pivot = th >= 0 ? half : -half;
      v.rock.position.z = pivot;
      v.body.position.z = -pivot;
      v.rock.rotation.x = th;
      const slide = v.it.backed ? Math.max(0, s.slide) : s.slide;
      v.yaw.position.set(v.base.x + v.f.x * slide, 0, v.base.z + v.f.y * slide);
    }
    this.render();
  }

  rest() {
    const states = {};
    for (const id of this.items.keys()) states[id] = { tilt: 0, slide: 0 };
    this.pose(states);
  }

  stop() {
    if (this.anim) cancelAnimationFrame(this.anim);
    this.anim = null;
  }

  /**
   * Plays an earthquake trace (from Engine.trace) in real time. onFrame(frameIndex) is called as
   * it goes and onEnd() at the end. With reduced motion it jumps to the end.
   */
  play(trace, ids, onFrame, onEnd) {
    this.stop();
    const n = trace.frames;
    // Floor displacement for the picture, from the acceleration with leaky integration (no drift).
    const dx = new Float32Array(n);
    const dz = new Float32Array(n);
    let vx = 0, vz = 0, px = 0, pz = 0;
    for (let i = 0; i < n; i++) {
      vx = 0.97 * vx + trace.ax[i] * 9.81 * trace.dt;
      vz = 0.97 * vz + trace.ay[i] * 9.81 * trace.dt;
      px = 0.97 * px + vx * trace.dt;
      pz = 0.97 * pz + vz * trace.dt;
      dx[i] = px * 1.5;
      dz[i] = pz * 1.5;
    }
    const frame = (i) => {
      const states = {};
      ids.forEach((id, j) => (states[id] = { tilt: trace.items[j].tilt[i], slide: trace.items[j].slide[i] }));
      this.pose(states, { x: dx[i], z: dz[i] });
      onFrame?.(i);
    };
    if (reducedMotion() || !this.ok) {
      const states = {};
      ids.forEach((id, j) => (states[id] = { tilt: trace.items[j].tilt[n - 1], slide: trace.items[j].slide[n - 1] }));
      this.pose(states);
      onFrame?.(n - 1);
      onEnd?.();
      return;
    }
    const start = performance.now();
    const step = () => {
      const i = Math.min(n - 1, Math.floor((performance.now() - start) / 1000 / trace.dt));
      frame(i);
      if (i < n - 1) this.anim = requestAnimationFrame(step);
      else {
        this.anim = null;
        this.pose(Object.fromEntries(ids.map((id, j) => [id, { tilt: trace.items[j].tilt[n - 1], slide: trace.items[j].slide[n - 1] }])));
        onEnd?.();
      }
    };
    this.anim = requestAnimationFrame(step);
  }
}
