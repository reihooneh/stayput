// A thin, checked wrapper round the WebAssembly core. Works in a page, in a worker and in Node.

import { coreItem, SOILS } from './model.js';

const ITEM_FIELDS = 6;
const MAX_ITEMS = 24;

export class Engine {
  constructor(instance) {
    this.x = instance.exports;
    this.levels = Array.from({ length: this.x.sp_w_levels() }, (_, i) => this.x.sp_w_level(i));
    this.frames = this.x.sp_w_frames();
    this.records = 0;
    this.key = '';
  }

  static async fromBytes(bytes) {
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return new Engine(instance);
  }

  static async load(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('the simulation could not be loaded');
    return Engine.fromBytes(await res.arrayBuffer());
  }

  /** Makes (or keeps) the set of synthetic earthquakes for a soil. */
  quakes(soil, count, seed = 20261110) {
    const key = `${soil}|${count}|${seed}`;
    if (key === this.key) return;
    if (!Object.hasOwn(SOILS, soil)) throw new Error('unknown ground');
    const rc = this.x.sp_w_generate(seed >>> 0, SOILS[soil], count);
    if (rc !== 0) throw new Error('the earthquakes could not be made');
    this.records = count;
    this.key = key;
  }

  write(items) {
    if (items.length < 1 || items.length > MAX_ITEMS) throw new Error('too many items');
    const buf = new Float64Array(this.x.memory.buffer, this.x.sp_w_items(), MAX_ITEMS * ITEM_FIELDS);
    items.forEach((v, j) => buf.set(v, j * ITEM_FIELDS));
  }

  /** Fragility curves for items given as core arrays (see coreItem). */
  room(items, storeys, floor) {
    this.write(items);
    const rc = this.x.sp_w_room(items.length, storeys, floor);
    if (rc !== 0) throw new Error(`the simulation refused the room (${rc})`);
    const L = this.levels.length;
    const per = 3 + 3 * L;
    const out = new Float64Array(this.x.memory.buffer, this.x.sp_w_out(), items.length * per);
    return items.map((_, j) => {
      const o = out.subarray(j * per, (j + 1) * per);
      return {
        median: o[0],
        beta: o[1],
        records: o[2],
        levels: this.levels.slice(),
        topples: Array.from(o.subarray(3, 3 + L)),
        forwards: Array.from(o.subarray(3 + L, 3 + 2 * L)),
        slide: Array.from(o.subarray(3 + 2 * L, 3 + 3 * L)),
      };
    });
  }

  /** One earthquake for the animation: floor accelerations and each item's tilt and slide, 50 frames a second. */
  trace(items, record, pga, storeys, floor) {
    this.write(items);
    const frames = this.x.sp_w_trace(items.length, record, pga, storeys, floor);
    if (frames <= 0) throw new Error(`the simulation refused the earthquake (${frames})`);
    const all = new Float32Array(this.x.memory.buffer, this.x.sp_w_trace_buf(), (2 + 2 * items.length) * frames).slice();
    const out = new Float64Array(this.x.memory.buffer, this.x.sp_w_out(), items.length * 3);
    return {
      frames,
      dt: 0.02,
      ax: all.subarray(0, frames),
      ay: all.subarray(frames, 2 * frames),
      items: items.map((_, j) => ({
        tilt: all.subarray((2 + 2 * j) * frames, (3 + 2 * j) * frames),
        slide: all.subarray((3 + 2 * j) * frames, (4 + 2 * j) * frames),
        outcome: ['still', 'rocked', 'slid', 'toppled'][out[j * 3]] ?? 'still',
        forwards: out[j * 3 + 1] === 1,
        when: out[j * 3 + 2],
      })),
    };
  }

  /** The rocking geometry of one item: slenderness angle, the acceleration that starts it rocking, restitution, Housner's p. */
  shape(item) {
    this.write([item]);
    if (this.x.sp_w_shape() !== 0) throw new Error('bad item');
    const o = new Float64Array(this.x.memory.buffer, this.x.sp_w_out(), 4);
    return { alpha: o[0], tip: o[1], restore: o[2], p: o[3] };
  }
}

export { coreItem };
