// The explorer: one piece of furniture, its fragility curves (with the size and floor effects)
// and one earthquake played close up.

import { Engine } from './engine.js';
import { $, el, simulator } from './dom.js';
import { chance, FEET, INTENSITIES, LOADS } from './model.js';
import { lineChart } from './charts.js';
import { RoomView } from './scene3d.js';

const RECORDS = 24;
const sim = simulator();
const view = new RoomView($('#view'), { caption: 'The piece of furniture in 3D' });
let engine = null;
let intensity = INTENSITIES[2];
let record = 0;
let timer = null;
let request = 0;

function settings() {
  const depth = Number($('#depth').value);
  const height = Number($('#height').value);
  const storeys = Math.round(Number($('#storeys').value));
  const floor = Math.round(Number($('#floor').value));
  const s = { depth, height, load: $('#load').value, feet: $('#feet').value, backed: $('#backed').checked, storeys, floor, soil: $('#soil').value };
  if (!(storeys >= 1 && storeys <= 60) || !(floor >= 0 && floor < storeys)) throw new Error('the floor must be from 0 (ground) to one below the number of storeys');
  if (!Object.hasOwn(LOADS, s.load) || !Object.hasOwn(FEET, s.feet)) throw new Error('unknown setting');
  return s;
}

function core(s, k = 1) {
  return [Math.min(2, s.depth * k), Math.min(3, s.height * k), LOADS[s.load], FEET[s.feet], s.backed ? 1 : 0, Math.PI / 2];
}

function curvePoints(c) {
  const pts = [];
  for (let g = 0.02; g <= 1.2001; g += 0.02) pts.push([g, chance(c, g)]);
  return pts;
}

function dots(c) {
  return c.levels.map((g, i) => [g, c.topples[i] / c.records]);
}

async function update() {
  let s;
  try {
    s = settings();
    $('#form-error').hidden = true;
  } catch (e) {
    $('#form-error').textContent = `${e.message}.`;
    $('#form-error').hidden = false;
    return;
  }
  $('#depth-out').textContent = `${s.depth.toFixed(2)} m`;
  $('#height-out').textContent = `${s.height.toFixed(2)} m`;
  const mine = ++request;
  $('#status').textContent = `Simulating ${RECORDS} earthquakes at 16 strengths, four ways…`;
  const yours = core(s);
  const [here, ground] = await Promise.all([
    sim.run({ items: [yours, core(s, Math.min(2, 3 / s.height, 2 / s.depth)), core(s, 0.5)], records: RECORDS, storeys: s.storeys, floor: s.floor, soil: s.soil }),
    sim.run({ items: [yours], records: RECORDS, storeys: 1, floor: 0, soil: s.soil }),
  ]);
  if (mine !== request) return;
  const [c, big, small] = here.curves;
  const g0 = ground.curves[0];
  const shape = engine.shape(yours);
  const fmt = (m) => (m >= 1e8 ? 'never' : `${m.toFixed(2)} g`);
  $('#r-tip').textContent = FEET[s.feet] < shape.tip ? `slides at ${FEET[s.feet].toFixed(2)} g` : `${shape.tip.toFixed(2)} g`;
  $('#r-median').textContent = c.median > 1.2 && c.median < 1e8 ? 'over 1.2 g' : fmt(c.median);
  $('#r-floor').textContent = g0.median > 1.2 && g0.median < 1e8 ? 'over 1.2 g' : fmt(g0.median);
  lineChart($('#curve'), {
    label: 'Chance of toppling against peak ground acceleration',
    x: { min: 0, max: 1.2, label: 'Peak ground acceleration (g)', format: (v) => v.toFixed(1) },
    y: { min: 0, max: 1, label: 'Chance', format: (v) => `${Math.round(v * 100)}%` },
    series: [
      { points: curvePoints(small), cls: 'smaller' },
      { points: curvePoints(big), cls: 'bigger' },
      { points: curvePoints(g0), cls: 'ground' },
      { points: curvePoints(c), dots: dots(c), cls: 'yours' },
    ],
    marks: [{ x: intensity.pga }],
  });
  const slides = FEET[s.feet] < shape.tip;
  $('#status').textContent = slides
    ? 'It grips the floor less than it would take to tip it, so it slides instead of rocking: it can still walk across the room, but it will not topple.'
    : `Dots are the share of the ${RECORDS} earthquakes that toppled it at each strength; the line is the fitted curve. The dotted line marks intensity ${intensity.id}.`;
  document.body.dataset.ready = 'true';
  document.body.dataset.runs = String(Number(document.body.dataset.runs ?? 0) + 1);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => update().catch((e) => ($('#status').textContent = `The simulation stopped: ${e.message}.`)), 200);
}

function shake() {
  const s = settings();
  engine.quakes(s.soil, RECORDS);
  const item = core(s);
  const trace = engine.trace([item], record, intensity.pga, s.storeys, s.floor);
  const it = { id: 'it', kind: 'bookcase', name: 'Furniture', x: 1.2, y: s.depth / 2, rotation: 0, width: 0.8, depth: s.depth, height: s.height, mass: 50, load: s.load, feet: s.feet, backed: s.backed, anchored: false };
  view.setRoom({ name: 'Test', width: 2.4, depth: Math.max(2, s.height + 0.6), storeys: 1, floor: 0, soil: s.soil, items: [it], zones: [] });
  const shape = engine.shape(item);
  // Along its depth: the item's axis is +y in the room, the second component.
  const accel = Array.from(trace.ay, (v, i) => [i * trace.dt, v]);
  const tilt = Array.from(trace.items[0].tilt, (v, i) => [i * trace.dt, Math.max(-1.5, Math.min(1.5, v / shape.alpha))]);
  let peak = 0.2;
  for (const [, v] of accel) peak = Math.max(peak, Math.abs(v));
  const top = Math.max(1.2, Math.ceil(peak * 5) / 5);
  lineChart($('#motion'), {
    label: 'Floor acceleration and tilt over time',
    x: { min: 0, max: 15, label: 'Time (s)', format: (v) => String(v) },
    y: { min: -top, max: top, label: '', format: (v) => v.toFixed(1) },
    series: [{ points: accel, cls: 'accel' }, { points: [[0, 1], [15, 1]], cls: 'mark-line' }, { points: tilt, cls: 'tilt' }],
  });
  $('#shake').disabled = $('#another').disabled = true;
  $('#shake-status').textContent = `Earthquake ${record + 1} of ${RECORDS} at intensity ${intensity.id}…`;
  view.play(trace, ['it'], null, () => {
    const t = trace.items[0];
    const what = t.outcome === 'toppled' ? `it toppled ${t.forwards ? 'forwards' : 'backwards'} after ${t.when.toFixed(1)} s` : t.outcome === 'rocked' ? 'it rocked but stayed up' : t.outcome === 'slid' ? 'it slid but stayed up' : 'it did not move';
    $('#shake-status').textContent = `Earthquake ${record + 1} of ${RECORDS} at intensity ${intensity.id}: ${what}.`;
    $('#shake').disabled = $('#another').disabled = false;
  });
}

async function main() {
  const seg = $('#intensity');
  for (const I of INTENSITIES) {
    const input = el('input', { type: 'radio', name: 'intensity', value: I.id, checked: I === intensity, 'aria-label': `${I.id}, ${I.name.toLowerCase()} shaking` });
    input.addEventListener('change', () => {
      intensity = I;
      schedule();
    });
    seg.append(el('label', {}, input, el('span', { text: I.id })));
  }
  for (const id of ['#depth', '#height', '#load', '#feet', '#backed', '#storeys', '#floor', '#soil']) {
    $(id).addEventListener(id.startsWith('#d') || id.startsWith('#h') ? 'input' : 'change', schedule);
  }
  engine = await Engine.load(new URL('../stayput.wasm', import.meta.url));
  await update();
  $('#shake').disabled = $('#another').disabled = false;
  $('#shake').addEventListener('click', shake);
  $('#another').addEventListener('click', () => {
    record = (record + 1) % RECORDS;
    shake();
  });
  shake();
}

main().catch((e) => {
  $('#status').textContent = `The simulation could not start: ${e.message}.`;
  document.body.dataset.ready = 'true';
});
