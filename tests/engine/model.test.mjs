// Tests for the room model and the WebAssembly interface, in Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  assess, axisAngle, chance, chanceAny, checkRoom, checklist, coreItem, facing, footprint, INTENSITIES, landing, ncdf, parseRoom, plan, restingTilt, RoomError,
} from '../../src/web/model.js';
import { Engine } from '../../src/web/engine.js';

const ROOMS = new URL('../../rooms/', import.meta.url);
const load = (f) => checkRoom(JSON.parse(readFileSync(new URL(f, ROOMS), 'utf8')));
const base = () => ({
  name: 'Test', width: 4, depth: 3,
  items: [{ id: 'case', kind: 'bookcase', x: 0.5, y: 0.15, rotation: 0, width: 0.8, depth: 0.3, height: 1.9, mass: 60, backed: true }],
  zones: [{ kind: 'bed', x: 0.2, y: 1.0, width: 1.5, depth: 1.9 }],
});
const wasm = await Engine.fromBytes(readFileSync(new URL('../../site/assets/stayput.wasm', import.meta.url)));

test('every example room is valid', () => {
  for (const f of readdirSync(ROOMS).filter((x) => x.endsWith('.json'))) {
    const room = load(f);
    assert.ok(room.items.length >= 3 && room.zones.some((z) => z.kind === 'exit'), f);
  }
});

test('footprints, facing and landing strips', () => {
  const it = { x: 1, y: 1, rotation: 90, width: 0.8, depth: 0.3, height: 1.9 };
  assert.deepEqual(footprint(it), { x: 0.85, y: 0.6, width: 0.3, depth: 0.8 });
  assert.deepEqual(facing(90), { x: 1, y: 0 });
  assert.equal(axisAngle(0), Math.PI / 2);
  const room = { width: 4, depth: 3 };
  const fwd = landing(it, room, true);
  for (const [k, v] of Object.entries({ x: 1.15, y: 0.6, width: 1.9, depth: 0.8 })) assert.ok(Math.abs(fwd[k] - v) < 1e-12, `falls 1.9 m forwards from its front (${k})`);
  const back = landing(it, room, false);
  assert.ok(Math.abs(back.x) < 1e-12 && Math.abs(back.width - 0.85) < 1e-12, 'clipped by the wall behind');
});

test('a toppling item comes to rest on a bed in its way', () => {
  const room = checkRoom(base());
  const it = room.items[0];
  // Front face at y = 0.3, bed edge at y = 1.0 (0.7 m away), bed top 0.5 m: tan(tilt) = 0.7 / 0.5.
  assert.ok(Math.abs(restingTilt(it, room, true) - Math.atan2(0.7, 0.5)) < 1e-12);
  const far = checkRoom({ ...base(), zones: [{ kind: 'bed', x: 0.2, y: 2.5, width: 1.5, depth: 0.5 }] });
  assert.equal(restingTilt(far.items[0], far, true), Math.PI / 2, 'out of reach: it lies flat');
});

test('the normal distribution and the curves', () => {
  assert.ok(Math.abs(ncdf(0) - 0.5) < 1e-15 && Math.abs(ncdf(1.96) - 0.9750021048517795) < 1e-12 && Math.abs(ncdf(-3) - 0.0013498980316301) < 1e-13);
  const c = { median: 0.3, beta: 0.4 };
  assert.ok(Math.abs(chance(c, 0.3) - 0.5) < 1e-12);
  assert.ok(chance(c, 0.6) > chance(c, 0.45) && chance(c, 0.1) < 0.01);
  assert.equal(chance({ median: 1e9, beta: 0 }, 1.2), 0);
  assert.equal(wasm.x.sp_w_prob(0.3, 0.4, 0.45).toFixed(12), chance(c, 0.45).toFixed(12), 'the page and the core agree');
});

test('hits, harm and the plan order', () => {
  const room = checkRoom(base());
  const sure = { median: 0.2, beta: 0.3, levels: [0.45], topples: [24], forwards: [24], records: 24 };
  const a = assess(room, room.items[0], sure, 0.45);
  assert.ok(a.chance > 0.99 && a.hits.length === 1 && a.hits[0].zone.kind === 'bed' && a.harm > 0);
  const anchored = checkRoom({ ...base(), items: [{ ...base().items[0], anchored: true }] });
  assert.equal(assess(anchored, anchored.items[0], sure, 0.45).chance, 0, 'an anchored item does not fall');
  const two = checkRoom({
    ...base(),
    items: [base().items[0], { id: 'far', kind: 'bookcase', x: 3.5, y: 0.15, rotation: 0, width: 0.8, depth: 0.3, height: 1.9, mass: 60, backed: true }],
  });
  const rows = plan(two, { case: sure, far: sure }, 0.45);
  assert.equal(rows[0].item.id, 'case', 'the one that lands on the bed comes first');
  assert.equal(rows[0].action.kind, 'anchor');
  assert.ok(chanceAny(rows, 'bed') > 0.99);
  const text = checklist(two, rows, INTENSITIES[2]);
  assert.match(text, /^Stayput checklist: Test\n/);
  assert.match(text, /1\. Tall bookcase: falls over 99%; lands on: Bed/);
});

test('hostile and broken room files are refused without echoing them', () => {
  const bad = [
    ['not json', 'not valid JSON'],
    ['[]', 'must be an object'],
    ['{"width":4,"depth":3,"items":[],"__proto__":{"admin":true}}', 'unknown setting'],
    [JSON.stringify({ ...base(), extra: 1 }), 'unknown setting'],
    [JSON.stringify({ ...base(), name: '<img src=x onerror=alert(1)>' }), 'room name'],
    [JSON.stringify({ ...base(), width: 1e9 }), 'room width'],
    [JSON.stringify({ ...base(), width: '4' }), 'room width'],
    [JSON.stringify({ ...base(), storeys: 3, floor: 3 }), 'below the roof'],
    [JSON.stringify({ ...base(), storeys: 2.5 }), 'whole numbers'],
    [JSON.stringify({ ...base(), soil: 'lava' }), 'the ground'],
    [JSON.stringify({ ...base(), items: Array(13).fill(base().items[0]) }), 'from 1 to 12'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], kind: 'constructor' }] }), 'item kind'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], kind: 'toString' }] }), 'item kind'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], x: 3.9 }] }), 'inside the room'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], rotation: 45 }] }), 'rotation'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], backed: 'yes' }] }), 'true or false'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], id: '../x' }] }), 'item id'],
    [JSON.stringify({ ...base(), items: [base().items[0], base().items[0]] }), 'different'],
    [JSON.stringify({ ...base(), items: [{ ...base().items[0], height: null }] }), 'item height'],
    [JSON.stringify({ ...base(), zones: [{ kind: 'bed', x: 3, y: 0, width: 2, depth: 1 }] }), 'inside the room'],
    [JSON.stringify({ ...base(), zones: [{ kind: 'pool', x: 0, y: 0, width: 1, depth: 1 }] }), 'place kind'],
    [`{"width":4,"depth":3,"items":[${'1,'.repeat(20000)}1]}`, 'larger than 32 KB'],
  ];
  for (const [text, want] of bad) {
    assert.throws(() => parseRoom(text), (e) => e instanceof RoomError && e.message.includes(want) && !e.message.includes('<img') && !e.message.includes('onerror'), want);
  }
  assert.equal(({}).admin, undefined, 'no prototype pollution');
  const ok = parseRoom(JSON.stringify(base()));
  assert.equal(ok.items[0].load, 'even');
  assert.equal(ok.items[0].feet, 'wood');
  assert.equal(Object.getPrototypeOf(ok), Object.prototype);
});

test('the WebAssembly interface checks its arguments and is deterministic', () => {
  assert.throws(() => wasm.quakes('lava', 8));
  assert.throws(() => wasm.quakes('firm', 0));
  assert.throws(() => wasm.quakes('firm', 65));
  wasm.quakes('firm', 8);
  const item = coreItem(checkRoom(base()).items[0]);
  const a = wasm.room([item], 1, 0);
  wasm.key = '';
  wasm.quakes('firm', 8);
  const b = wasm.room([item], 1, 0);
  assert.deepEqual(a, b, 'the same seed gives the same curves');
  assert.ok(a[0].median > 0.1 && a[0].median < 1.2 && a[0].beta > 0);
  assert.throws(() => wasm.room([item], 3, 3), /refused/);
  assert.throws(() => wasm.room([[0.01, 1.9, 0.5, 0.4, 1, 0]], 1, 0), /refused/);
  assert.throws(() => wasm.room([[0.3, 1.9, 0.5, 0.4, 0.5, 0]], 1, 0), /refused/, 'backed must be 0 or 1');
  assert.throws(() => wasm.room([[0.3, 1.9, 0.5, 0.4, 1, NaN]], 1, 0), /refused/);
  assert.throws(() => wasm.room(Array(25).fill(item), 1, 0), /too many/);
  assert.throws(() => wasm.trace([item], 8, 0.4, 1, 0), /refused/, 'no such earthquake');
  assert.throws(() => wasm.trace([item], 0, 5, 1, 0), /refused/, 'shaking out of range');
  const t = wasm.trace([item], 0, 0.8, 1, 0);
  assert.equal(t.frames, 750);
  assert.ok(['still', 'rocked', 'slid', 'toppled'].includes(t.items[0].outcome));
  const g = wasm.shape(item);
  assert.ok(Math.abs(g.tip - 0.15 / 0.95) < 1e-12, 'tan alpha = half depth / centre of mass height');
});

test('every example room runs, and anchoring the top item helps', () => {
  for (const f of readdirSync(ROOMS).filter((x) => x.endsWith('.json'))) {
    const room = load(f);
    wasm.quakes(room.soil, 12);
    const res = wasm.room(room.items.map((it) => coreItem(it)), room.storeys, room.floor);
    const curves = Object.fromEntries(room.items.map((it, j) => [it.id, res[j]]));
    const rows = plan(room, curves, 0.45);
    const people = room.zones.find((z) => z.kind !== 'exit');
    const before = chanceAny(rows, people.kind);
    const fixed = checkRoom({ ...room, items: room.items.map((it) => (it.id === rows[0].item.id ? { ...it, anchored: true } : it)) });
    const after = chanceAny(plan(fixed, curves, 0.45), people.kind);
    assert.ok(after <= before + 1e-12, `${f}: anchoring the first item never makes it worse`);
  }
});
