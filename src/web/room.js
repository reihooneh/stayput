// The room checker: edit a room, rerun the Monte Carlo in a worker, show the plan.

import { Engine } from './engine.js';
import { $, clear, download, el, loadJson, simulator } from './dom.js';
import {
  checkRoom, checklist, chanceAny, coreItem, expectedFalls, forwardShare, INTENSITIES, KINDS, LIMITS, parseRoom, pct, plan, RoomError,
} from './model.js';
import { PlanView } from './plan2d.js';
import { RoomView } from './scene3d.js';

const RECORDS = 24;
const sim = simulator();
let room = null;
let selected = null;
let intensity = INTENSITIES[2];
let curves = {};
let lowered = {};
let rows = [];
let request = 0;
let simKey = '';
let timer = null;
let engine = null;

const status = $('#status');
const formError = $('#form-error');
const planView = new PlanView($('#plan'), {
  onSelect: (id) => select(id),
  onMove: (id, x, y, done, turn) => move(id, x, y, done, turn),
});
const view = new RoomView($('#view'), { caption: 'This room in 3D: drag to look around' });

function showError(msg) {
  formError.textContent = msg;
  formError.hidden = !msg;
}

/** Applies a change only if the resulting room passes the same checks as a loaded file. */
function apply(next, { rerun = true } = {}) {
  try {
    room = checkRoom(next);
    showError('');
  } catch (e) {
    if (e instanceof RoomError) {
      showError(`That change was not made: ${e.message}.`);
      fillEditor();
      return false;
    }
    throw e;
  }
  if (!room.items.some((it) => it.id === selected)) selected = room.items[0]?.id ?? null;
  fillRoom();
  fillEditor();
  view.setRoom(room);
  if (rerun) schedule();
  else refresh();
  return true;
}

function plain(r) {
  return JSON.parse(JSON.stringify(r));
}

function fillRoom() {
  $('#room-width').value = room.width;
  $('#room-depth').value = room.depth;
  $('#storeys').value = room.storeys;
  $('#floor').value = room.floor;
  $('#floor').max = String(room.storeys - 1);
  $('#soil').value = room.soil;
  const list = clear($('#items'));
  room.items.forEach((it, i) => {
    const b = el('button', { class: 'button quiet', type: 'button', 'aria-pressed': String(it.id === selected) }, el('span', { class: 'num-badge', text: String(i + 1) }), el('span', { text: it.name }));
    b.addEventListener('click', () => select(it.id));
    list.append(el('li', {}, b));
  });
  $('#add').disabled = room.items.length >= LIMITS.items;
}

function fillEditor() {
  const it = room?.items.find((x) => x.id === selected);
  $('#editor').hidden = !it;
  if (!it) return;
  $('#editor-title').textContent = it.name;
  $('#it-name').value = it.name;
  $('#it-width').value = it.width;
  $('#it-depth').value = it.depth;
  $('#it-height').value = it.height;
  $('#it-mass').value = it.mass;
  $('#it-load').value = it.load;
  $('#it-feet').value = it.feet;
  $('#it-backed').checked = it.backed;
  $('#it-anchored').checked = it.anchored;
  $('#remove').disabled = room.items.length <= 1;
}

function select(id) {
  selected = id;
  fillRoom();
  fillEditor();
  planView.select(id);
}

function clampInside(it, x, y) {
  const turned = it.rotation === 90 || it.rotation === 270;
  const hw = (turned ? it.depth : it.width) / 2;
  const hd = (turned ? it.width : it.depth) / 2;
  const snap = (v) => Math.round(v * 100) / 100;
  return [snap(Math.min(room.width - hw, Math.max(hw, x))), snap(Math.min(room.depth - hd, Math.max(hd, y)))];
}

function move(id, x, y, done, turn = false) {
  const next = plain(room);
  const it = next.items.find((i) => i.id === id);
  if (!it) return;
  if (turn) it.rotation = (it.rotation + 90) % 360;
  [it.x, it.y] = clampInside(it, x, y);
  if (!done) {
    // While dragging: move it on the plan only, without rerunning anything.
    const live = room.items.find((i) => i.id === id);
    live.x = it.x;
    live.y = it.y;
    planView.set(room, riskById());
    return;
  }
  apply(next, { rerun: turn });
  planView.select(id);
}

function editItem(change) {
  const next = plain(room);
  const it = next.items.find((i) => i.id === selected);
  if (!it) return;
  change(it);
  [it.x, it.y] = clampInside(it, it.x, it.y);
  apply(next);
}

function simInputs() {
  const items = [];
  const map = [];
  for (const it of room.items) {
    items.push(coreItem(it));
    map.push([it.id, false]);
  }
  for (const it of room.items) {
    if (it.load === 'low' || items.length >= 24) continue;
    items.push(coreItem(it, 'low'));
    map.push([it.id, true]);
  }
  return { items, map };
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(run, 250);
}

async function run() {
  const { items, map } = simInputs();
  const key = JSON.stringify([items, room.storeys, room.floor, room.soil]);
  if (key === simKey) {
    refresh();
    return;
  }
  const mine = ++request;
  status.textContent = `Simulating ${RECORDS} earthquakes at 16 strengths for ${room.items.length} item${room.items.length === 1 ? '' : 's'}…`;
  document.body.dataset.busy = 'true';
  try {
    const res = await sim.run({ items, records: RECORDS, storeys: room.storeys, floor: room.floor, soil: room.soil });
    if (mine !== request) return;
    simKey = key;
    curves = {};
    lowered = {};
    res.curves.forEach((c, j) => {
      const [id, low] = map[j];
      (low ? lowered : curves)[id] = c;
    });
    const n = RECORDS * 16 * items.length;
    status.textContent = `${n.toLocaleString('en')} simulated topple tests in ${(res.ms / 1000).toFixed(1)} s.`;
    refresh();
  } catch (e) {
    if (mine === request) status.textContent = `The simulation stopped: ${e.message}.`;
  } finally {
    if (mine === request) {
      delete document.body.dataset.busy;
      document.body.dataset.ready = 'true';
      document.body.dataset.runs = String(Number(document.body.dataset.runs ?? 0) + 1);
    }
  }
}

function riskById() {
  const out = {};
  for (const r of rows) out[r.item.id] = { chance: r.chance, forwardShare: curves[r.item.id] ? forwardShare(curves[r.item.id], intensity.pga) : 1 };
  return out;
}

function refresh() {
  if (!room.items.every((it) => curves[it.id])) {
    planView.set(room, {});
    return;
  }
  rows = plan(room, curves, intensity.pga, lowered);
  planView.set(room, riskById());
  planView.select(selected);
  const falls = expectedFalls(rows);
  const people = room.zones.filter((z) => z.kind !== 'exit');
  const worst = people.map((z) => ({ z, p: chanceAny(rows, z.kind) })).sort((a, b) => b.p - a.p)[0];
  const exit = chanceAny(rows, 'exit');
  const parts = [`In ${intensity.name.toLowerCase()} shaking, about ${falls < 0.05 ? 'nothing' : falls.toFixed(1)} of ${room.items.length} items fall`];
  if (worst && worst.p >= 0.01) parts.push(`the chance something lands on the ${worst.z.name.toLowerCase()} is ${pct(worst.p)}`);
  if (exit >= 0.01) parts.push(`the chance the doorway is blocked is ${pct(exit)}`);
  const last = parts.length > 1 ? parts.pop() : null;
  $('#verdict').textContent = `${parts.join(', ')}${last ? `, and ${last}` : ''}.`;

  const body = clear($('#results tbody'));
  for (const r of rows) {
    const idx = room.items.indexOf(r.item) + 1;
    const hits = r.hits.filter((h) => h.chance >= 0.005);
    body.append(el('tr', {},
      el('td', { 'data-label': 'Item' }, el('span', { class: 'item-name' }, el('span', { class: 'num-badge', text: String(idx) }), ' ', r.item.name)),
      el('td', { 'data-label': 'Falls', class: `num${r.chance >= 0.25 ? ' hi' : ''}`, text: pct(r.chance) }),
      el('td', { 'data-label': 'Lands on', text: hits.length ? hits.map((h) => `${h.zone.name} (${pct(h.chance)})`).join(', ') : r.chance >= 0.02 ? 'The floor' : 'Nowhere' }),
      el('td', { 'data-label': 'What to do', text: r.action.text })));
  }
  const list = clear($('#anchors'));
  const todo = rows.filter((r) => r.action.kind === 'anchor' || r.action.kind === 'lower');
  if (!todo.length) list.append(el('li', {}, el('div', {}, el('strong', { text: 'Nothing needs doing for this strength of shaking.' }), el('span', { text: 'Try a stronger one above.' }))));
  let left = rows.map((r) => ({ ...r }));
  for (const r of todo) {
    // What the room looks like once this item (and those before it) are dealt with.
    left = left.map((x) => (x.item.id === r.item.id ? { ...x, chance: r.action.kind === 'lower' ? r.action.chance : 0, hits: r.action.kind === 'lower' ? x.hits.map((h) => ({ ...h, chance: (h.chance * r.action.chance) / Math.max(1e-9, x.chance) })) : [] } : x));
    const after = worst ? chanceAny(left, worst.z.kind) : 0;
    const note = worst && worst.p >= 0.01 ? `Then the chance something lands on the ${worst.z.name.toLowerCase()}: ${pct(after)}.` : `Then about ${expectedFalls(left).toFixed(1)} items fall.`;
    list.append(el('li', {}, el('div', {}, el('strong', { text: `${r.item.name}: ${r.action.text}` }), el('span', { class: 'small', text: note }))));
  }
}

async function loadPreset(name) {
  const data = await loadJson(`assets/rooms/${name}.json`);
  selected = null;
  simKey = '';
  apply(data);
}

function intensityPicker() {
  const seg = $('#intensity');
  for (const I of INTENSITIES) {
    const input = el('input', { type: 'radio', name: 'intensity', value: I.id, checked: I === intensity, 'aria-label': `${I.id}, ${I.name.toLowerCase()} shaking` });
    input.addEventListener('change', () => {
      intensity = I;
      $('#intensity-note').textContent = `${I.id}, ${I.name.toLowerCase()}: ${I.felt} Peak ground acceleration about ${I.pga} g.`;
      refresh();
    });
    seg.append(el('label', {}, input, el('span', { text: I.id })));
  }
  $('#intensity-note').textContent = `${intensity.id}, ${intensity.name.toLowerCase()}: ${intensity.felt} Peak ground acceleration about ${intensity.pga} g.`;
}

function wire() {
  for (const [k, v] of Object.entries(KINDS)) $('#add-kind').append(el('option', { value: k, text: v.label }));
  $('#preset').addEventListener('change', (e) => loadPreset(e.target.value));
  const roomNum = (id, key) => $(id).addEventListener('change', (e) => apply({ ...plain(room), [key]: Number(e.target.value) }));
  roomNum('#room-width', 'width');
  roomNum('#room-depth', 'depth');
  roomNum('#storeys', 'storeys');
  roomNum('#floor', 'floor');
  $('#soil').addEventListener('change', (e) => apply({ ...plain(room), soil: e.target.value }));
  const itemNum = (id, key) => $(id).addEventListener('change', (e) => editItem((it) => (it[key] = Number(e.target.value))));
  itemNum('#it-width', 'width');
  itemNum('#it-depth', 'depth');
  itemNum('#it-height', 'height');
  itemNum('#it-mass', 'mass');
  $('#it-name').addEventListener('change', (e) => editItem((it) => (it.name = e.target.value.trim())));
  $('#it-load').addEventListener('change', (e) => editItem((it) => (it.load = e.target.value)));
  $('#it-feet').addEventListener('change', (e) => editItem((it) => (it.feet = e.target.value)));
  $('#it-backed').addEventListener('change', (e) => editItem((it) => (it.backed = e.target.checked)));
  $('#it-anchored').addEventListener('change', (e) => editItem((it) => (it.anchored = e.target.checked)));
  $('#turn').addEventListener('click', () => editItem((it) => (it.rotation = (it.rotation + 90) % 360)));
  $('#remove').addEventListener('click', () => {
    const next = plain(room);
    next.items = next.items.filter((i) => i.id !== selected);
    apply(next);
  });
  $('#add').addEventListener('click', () => {
    const kind = $('#add-kind').value;
    const k = KINDS[kind];
    const next = plain(room);
    let n = 1;
    while (next.items.some((i) => i.id === `${kind}-${n}`)) n++;
    const it = { id: `${kind}-${n}`, kind, name: k.label, x: room.width / 2, y: k.depth / 2, rotation: 0, width: k.width, depth: k.depth, height: k.height, mass: k.mass, load: k.load, feet: k.feet, backed: true, anchored: false };
    [it.x, it.y] = clampInside(it, it.x, it.y);
    next.items.push(it);
    if (apply(next)) select(it.id);
  });
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > LIMITS.fileBytes) {
      showError('That file was not opened: the room file is larger than 32 KB.');
      return;
    }
    try {
      const next = parseRoom(await f.text());
      selected = null;
      simKey = '';
      apply(next);
      status.textContent = `Opened ${next.name}.`;
    } catch (err) {
      if (!(err instanceof RoomError)) throw err;
      showError(`That file was not opened: ${err.message}. Still showing ${room.name}.`);
    }
  });
  $('#export').addEventListener('click', () => download(`${room.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'room'}.json`, `${JSON.stringify(room, null, 2)}\n`, 'application/json'));
  $('#checklist').addEventListener('click', () => download('stayput-checklist.txt', checklist(room, rows, intensity), 'text/plain'));
  $('#shake').addEventListener('click', async () => {
    engine ??= await Engine.load(new URL('../stayput.wasm', import.meta.url));
    engine.quakes(room.soil, RECORDS);
    const live = room.items.filter((it) => !it.anchored);
    if (!live.length) {
      $('#shake-status').textContent = 'Everything is anchored: nothing moves.';
      return;
    }
    const pick = Math.floor(Math.random() * RECORDS);
    const trace = engine.trace(live.map((it) => coreItem(it)), pick, intensity.pga, room.storeys, room.floor);
    $('#shake').disabled = true;
    $('#shake-status').textContent = `Earthquake ${pick + 1} of ${RECORDS} at intensity ${intensity.id}…`;
    view.rest();
    view.play(trace, live.map((it) => it.id), null, () => {
      const fell = live.filter((_, j) => trace.items[j].outcome === 'toppled').map((it) => it.name);
      $('#shake-status').textContent = `Earthquake ${pick + 1}: ${fell.length ? `${fell.join(', ')} toppled` : 'nothing toppled'}. Anchored items stay put.`;
      $('#shake').disabled = false;
    });
  });
}

intensityPicker();
wire();
loadPreset('bedroom').catch((e) => {
  status.textContent = `The room could not be loaded: ${e.message}.`;
  document.body.dataset.ready = 'true';
});
