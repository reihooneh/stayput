// Runs the Monte Carlo off the main thread, so the page stays responsive while thousands of
// earthquakes are simulated. Accepts only one message shape and checks it.

import { Engine } from './engine.js';

let engine = null;
const ready = Engine.load(new URL('../stayput.wasm', import.meta.url)).then((e) => (engine = e));

function finite(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  const id = msg && typeof msg.id === 'number' ? msg.id : 0;
  try {
    await ready;
    if (!msg || msg.type !== 'room' || !Array.isArray(msg.items) || msg.items.length < 1 || msg.items.length > 24) throw new Error('bad request');
    for (const it of msg.items) if (!Array.isArray(it) || it.length !== 6 || !it.every((v) => finite(v, -100, 100))) throw new Error('bad item');
    if (!finite(msg.records, 1, 64) || !finite(msg.storeys, 1, 60) || !finite(msg.floor, 0, 59)) throw new Error('bad settings');
    engine.quakes(msg.soil, msg.records);
    const started = performance.now();
    const curves = engine.room(msg.items, msg.storeys, msg.floor);
    self.postMessage({ id, ok: true, curves, ms: performance.now() - started });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : 'the simulation failed' });
  }
};
