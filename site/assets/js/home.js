// Home: a bedroom you can shake, the live seismograph, what each item did, and two live facts.

import { Engine } from './engine.js';
import { $, clear, el, loadJson, simulator } from './dom.js';
import { checkRoom, coreItem, INTENSITIES } from './model.js';
import { RoomView } from './scene3d.js';
import { seismograph } from './charts.js';

const RECORDS = 24;
const OUTCOME = { still: 'Stayed put', rocked: 'Rocked', slid: 'Slid', toppled: 'Toppled' };

const status = $('#home-status');
const seg = $('#intensity');
let intensity = INTENSITIES[2];
for (const I of INTENSITIES) {
  const input = el('input', { type: 'radio', name: 'intensity', value: I.id, checked: I === intensity, 'aria-label': `${I.id}, ${I.name.toLowerCase()} shaking` });
  input.addEventListener('change', () => (intensity = I));
  seg.append(el('label', {}, input, el('span', { text: I.id })));
}

const view = new RoomView($('#hero-view'), { caption: 'A bedroom in 3D: drag to look around' });
let engine, room, record = 0;

function outcomes(trace) {
  const list = clear($('#outcomes'));
  room.items.forEach((it, j) => {
    const t = trace ? trace.items[j] : null;
    const kind = t ? t.outcome : 'still';
    const note = t && kind === 'toppled' ? `${OUTCOME[kind]} ${t.forwards ? 'forwards' : 'backwards'} after ${t.when.toFixed(1)} s` : OUTCOME[kind];
    list.append(el('li', {}, el('span', { text: it.name }), el('span', { class: `tag ${kind}`, text: note })));
  });
}

function shake() {
  const items = room.items.map((it) => coreItem(it));
  const trace = engine.trace(items, record, intensity.pga, room.storeys, room.floor);
  let peak = 0;
  for (const v of trace.ax) peak = Math.max(peak, Math.abs(v));
  const box = $('#seismo');
  $('#shake').disabled = $('#another').disabled = true;
  status.textContent = `Earthquake ${record + 1} of ${RECORDS}: ${intensity.name.toLowerCase()} shaking, peak ground acceleration ${intensity.pga} g…`;
  clear($('#outcomes'));
  view.play(trace, room.items.map((it) => it.id), (i) => {
    if (i % 3 === 0 || i === trace.frames - 1) seismograph(box, trace.ax, i, peak);
  }, () => {
    seismograph(box, trace.ax, trace.frames, peak);
    const fell = trace.items.filter((t) => t.outcome === 'toppled').length;
    status.textContent = `Earthquake ${record + 1} of ${RECORDS}, intensity ${intensity.id}: ${fell === 0 ? 'nothing toppled' : `${fell} of ${room.items.length} items toppled`}. One earthquake is luck; the room checker runs them all.`;
    outcomes(trace);
    $('#shake').disabled = $('#another').disabled = false;
    document.body.dataset.shaken = String(Number(document.body.dataset.shaken ?? 0) + 1);
  });
}

async function facts() {
  const sim = simulator();
  const bookcase = [0.3, 1.9, 0.5, 0.4, 1, Math.PI / 2];
  const [ground, high] = await Promise.all([
    sim.run({ items: [bookcase], records: RECORDS, storeys: 1, floor: 0, soil: 'firm' }),
    sim.run({ items: [bookcase], records: RECORDS, storeys: 10, floor: 7, soil: 'firm' }),
  ]);
  $('#fact-ground').textContent = `${ground.curves[0].median.toFixed(2)} g`;
  $('#fact-high').textContent = `${high.curves[0].median.toFixed(2)} g`;
}

async function main() {
  try {
    [engine, room] = await Promise.all([Engine.load(new URL('../stayput.wasm', import.meta.url)), loadJson('assets/rooms/bedroom.json').then(checkRoom)]);
    engine.quakes(room.soil, RECORDS);
    view.setRoom(room);
    seismograph($('#seismo'), new Float32Array(2), 0, 1);
    outcomes(null);
    status.textContent = 'A bedroom on the ground floor. Choose a strength and shake it.';
    $('#shake').disabled = $('#another').disabled = false;
    $('#shake').addEventListener('click', shake);
    $('#another').addEventListener('click', () => {
      record = (record + 1) % RECORDS;
      shake();
    });
    await facts();
  } catch (e) {
    status.textContent = `The simulation could not start: ${e instanceof Error ? e.message : 'unknown error'}.`;
  } finally {
    document.body.dataset.ready = 'true';
  }
}

main();
