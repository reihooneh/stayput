// The room: its file format, strict checking of anything loaded, where each item lands if it
// falls, the chance it lands on someone, and the plan of what to anchor first. Pure functions,
// shared by the pages, the worker and the tests.

export const LIMITS = Object.freeze({ items: 12, zones: 8, roomMin: 1.5, roomMax: 15, fileBytes: 32 * 1024 });

/** Shaking strength on the Modified Mercalli scale, with a typical peak ground acceleration (Wald et al. 1999). */
export const INTENSITIES = Object.freeze([
  { id: 'VI', pga: 0.12, name: 'Strong', felt: 'Felt by all; heavy furniture moves; a few items fall.' },
  { id: 'VII', pga: 0.25, name: 'Very strong', felt: 'Hard to stand; furniture breaks; plaster cracks.' },
  { id: 'VIII', pga: 0.45, name: 'Severe', felt: 'Heavy furniture overturns; chimneys fall.' },
  { id: 'IX', pga: 0.8, name: 'Violent', felt: 'General panic; serious damage to buildings.' },
]);

export const SOILS = Object.freeze({ rock: 0, firm: 1, soft: 2 });

/** What a piece of furniture stands on: friction between its feet and the floor. */
export const FEET = Object.freeze({ felt: 0.25, wood: 0.4, carpet: 0.6, rubber: 0.8 });
/** How its weight is spread: centre of mass height as a fraction of its height. */
export const LOADS = Object.freeze({ low: 0.35, even: 0.5, high: 0.65 });

/** Furniture kinds with typical sizes (m) and masses (kg, loaded). */
export const KINDS = Object.freeze({
  bookcase: { label: 'Tall bookcase', width: 0.8, depth: 0.3, height: 1.9, mass: 60, load: 'even', feet: 'wood' },
  wardrobe: { label: 'Wardrobe', width: 1.0, depth: 0.58, height: 2.0, mass: 90, load: 'even', feet: 'wood' },
  dresser: { label: 'Chest of drawers', width: 0.9, depth: 0.48, height: 1.1, mass: 55, load: 'even', feet: 'wood' },
  shelf: { label: 'Narrow shelf unit', width: 0.6, depth: 0.25, height: 1.6, mass: 30, load: 'even', feet: 'wood' },
  tv: { label: 'TV on a stand', width: 1.2, depth: 0.4, height: 1.25, mass: 45, load: 'high', feet: 'wood' },
  fridge: { label: 'Fridge', width: 0.6, depth: 0.65, height: 1.8, mass: 70, load: 'even', feet: 'rubber' },
  lamp: { label: 'Floor lamp', width: 0.35, depth: 0.35, height: 1.6, mass: 6, load: 'low', feet: 'felt' },
  cabinet: { label: 'Display cabinet', width: 0.9, depth: 0.4, height: 1.8, mass: 50, load: 'even', feet: 'wood' },
});

/** Places people spend time, and roughly how many hours a day. A cot also counts double: a child can't get out of the way. */
export const ZONE_KINDS = Object.freeze({
  bed: { label: 'Bed', hours: 8, weight: 1 },
  cot: { label: "Child's bed", hours: 12, weight: 2 },
  desk: { label: 'Desk or seat', hours: 4, weight: 1 },
  sofa: { label: 'Sofa', hours: 3, weight: 1 },
  exit: { label: 'Doorway', hours: 0, weight: 0 },
});

export class RoomError extends Error {}

const NAME = /^[A-Za-z0-9][A-Za-z0-9 '.,&()!-]{0,39}$/;
const ID = /^[a-z][a-z0-9-]{0,23}$/;
const ROOM_KEYS = new Set(['name', 'width', 'depth', 'storeys', 'floor', 'soil', 'items', 'zones']);
const ITEM_KEYS = new Set(['id', 'kind', 'name', 'x', 'y', 'rotation', 'width', 'depth', 'height', 'mass', 'load', 'feet', 'backed', 'anchored']);
const ZONE_KEYS = new Set(['kind', 'name', 'x', 'y', 'width', 'depth']);

function own(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function plainObject(v, what) {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype) {
    throw new RoomError(`${what} must be an object`);
  }
}

function keysOnly(obj, allowed, what) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) throw new RoomError(`${what} has an unknown setting`);
  if (own(obj, '__proto__')) throw new RoomError(`${what} has an unknown setting`);
}

function num(v, what, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new RoomError(`${what} must be a number from ${lo} to ${hi}`);
  return v;
}

function pick(v, table, what) {
  if (typeof v !== 'string' || !own(table, v)) throw new RoomError(`${what} must be one of ${Object.keys(table).join(', ')}`);
  return v;
}

function name(v, what) {
  if (typeof v !== 'string' || !NAME.test(v)) throw new RoomError(`${what} must be a name of letters, digits and simple punctuation (up to 40)`);
  return v;
}

/** The item's footprint on the floor, as an axis-aligned rectangle (rotations are quarter turns). */
export function footprint(it) {
  const turned = it.rotation === 90 || it.rotation === 270;
  const w = turned ? it.depth : it.width;
  const d = turned ? it.width : it.depth;
  return { x: it.x - w / 2, y: it.y - d / 2, width: w, depth: d };
}

/** The direction the item's front faces in the plan: rotation 0 faces +y (into the room from the back wall). */
export function facing(rotation) {
  return { 0: { x: 0, y: 1 }, 90: { x: 1, y: 0 }, 180: { x: 0, y: -1 }, 270: { x: -1, y: 0 } }[rotation];
}

/** The rocking axis angle (radians) for the core: the item's depth direction in room coordinates. */
export function axisAngle(rotation) {
  const f = facing(rotation);
  return Math.atan2(f.y, f.x);
}

/**
 * Checks a room loaded from a file or built in the page. Returns a fresh, clean copy; anything
 * unexpected is refused with a message that never repeats the input.
 */
export function checkRoom(input) {
  plainObject(input, 'the room');
  keysOnly(input, ROOM_KEYS, 'the room');
  const room = {
    name: own(input, 'name') ? name(input.name, 'the room name') : 'My room',
    width: num(input.width, 'the room width (m)', LIMITS.roomMin, LIMITS.roomMax),
    depth: num(input.depth, 'the room depth (m)', LIMITS.roomMin, LIMITS.roomMax),
    storeys: own(input, 'storeys') ? num(input.storeys, 'the number of storeys', 1, 60) : 1,
    floor: own(input, 'floor') ? num(input.floor, 'the floor', 0, 59) : 0,
    soil: own(input, 'soil') ? pick(input.soil, SOILS, 'the ground') : 'firm',
    items: [],
    zones: [],
  };
  if (!Number.isInteger(room.storeys) || !Number.isInteger(room.floor)) throw new RoomError('storeys and floor must be whole numbers');
  if (room.floor >= room.storeys) throw new RoomError('the floor must be below the roof (floor 0 is the ground floor)');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > LIMITS.items) {
    throw new RoomError(`a room has from 1 to ${LIMITS.items} items`);
  }
  if (own(input, 'zones') && (!Array.isArray(input.zones) || input.zones.length > LIMITS.zones)) {
    throw new RoomError(`a room has at most ${LIMITS.zones} places people spend time`);
  }
  const ids = new Set();
  for (const raw of input.items) {
    plainObject(raw, 'an item');
    keysOnly(raw, ITEM_KEYS, 'an item');
    const kind = pick(raw.kind, KINDS, 'an item kind');
    const it = {
      id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : null,
      kind,
      name: own(raw, 'name') ? name(raw.name, 'an item name') : KINDS[kind].label,
      x: num(raw.x, 'an item position', 0, LIMITS.roomMax),
      y: num(raw.y, 'an item position', 0, LIMITS.roomMax),
      rotation: num(raw.rotation ?? 0, 'an item rotation', 0, 270),
      width: num(raw.width, 'an item width (m)', 0.1, 3),
      depth: num(raw.depth, 'an item depth (m)', 0.05, 2),
      height: num(raw.height, 'an item height (m)', 0.1, 3),
      mass: num(raw.mass, 'an item mass (kg)', 1, 500),
      load: own(raw, 'load') ? pick(raw.load, LOADS, 'an item load') : 'even',
      feet: own(raw, 'feet') ? pick(raw.feet, FEET, 'an item’s feet') : 'wood',
      backed: own(raw, 'backed') ? raw.backed === true : false,
      anchored: own(raw, 'anchored') ? raw.anchored === true : false,
    };
    if (raw.id !== undefined && it.id === null) throw new RoomError('an item id is lower-case letters, digits and -');
    if (!(it.rotation % 90 === 0)) throw new RoomError('an item rotation is 0, 90, 180 or 270');
    for (const flag of ['backed', 'anchored']) if (own(raw, flag) && typeof raw[flag] !== 'boolean') throw new RoomError(`${flag} must be true or false`);
    if (it.id === null) {
      let n = 1;
      while (ids.has(`${kind}-${n}`)) n++;
      it.id = `${kind}-${n}`;
    }
    if (ids.has(it.id)) throw new RoomError('each item id must be different');
    ids.add(it.id);
    const f = footprint(it);
    if (f.x < -1e-9 || f.y < -1e-9 || f.x + f.width > room.width + 1e-9 || f.y + f.depth > room.depth + 1e-9) {
      throw new RoomError('every item must stand inside the room');
    }
    room.items.push(it);
  }
  for (const raw of input.zones ?? []) {
    plainObject(raw, 'a place');
    keysOnly(raw, ZONE_KEYS, 'a place');
    const kind = pick(raw.kind, ZONE_KINDS, 'a place kind');
    const z = {
      kind,
      name: own(raw, 'name') ? name(raw.name, 'a place name') : ZONE_KINDS[kind].label,
      x: num(raw.x, 'a place position', 0, LIMITS.roomMax),
      y: num(raw.y, 'a place position', 0, LIMITS.roomMax),
      width: num(raw.width, 'a place width (m)', 0.2, LIMITS.roomMax),
      depth: num(raw.depth, 'a place depth (m)', 0.2, LIMITS.roomMax),
    };
    if (z.x + z.width > room.width + 1e-9 || z.y + z.depth > room.depth + 1e-9) throw new RoomError('every place must be inside the room');
    room.zones.push(z);
  }
  return room;
}

/** Parses and checks a room file's text. */
export function parseRoom(text) {
  if (typeof text !== 'string') throw new RoomError('the room file is not text');
  if (text.length > LIMITS.fileBytes) throw new RoomError('the room file is larger than 32 KB');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new RoomError('the room file is not valid JSON');
  }
  return checkRoom(data);
}

/** What the core needs for an item: [depth, height, centre of mass fraction, friction, backed, axis angle]. */
export function coreItem(it, loadOverride) {
  return [it.depth, it.height, LOADS[loadOverride ?? it.load], FEET[it.feet], it.backed ? 1 : 0, axisAngle(it.rotation)];
}

function clip(r, room) {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y);
  const x1 = Math.min(room.width, r.x + r.width), y1 = Math.min(room.depth, r.y + r.depth);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, depth: y1 - y0 } : null;
}

/**
 * Where an item lies after toppling forwards or backwards: a strip as long as it is tall, from its
 * front (or back) edge, as wide as it is. Clipped to the room (beyond a wall it would hit the wall).
 */
export function landing(it, room, forwards) {
  const f = footprint(it);
  const dir = facing(it.rotation);
  const s = forwards ? 1 : -1;
  const L = it.height;
  let r;
  if (dir.x === 0) {
    const edge = s * dir.y > 0 ? f.y + f.depth : f.y;
    r = { x: f.x, y: s * dir.y > 0 ? edge : edge - L, width: f.width, depth: L };
  } else {
    const edge = s * dir.x > 0 ? f.x + f.width : f.x;
    r = { x: s * dir.x > 0 ? edge : edge - L, y: f.y, width: L, depth: f.depth };
  }
  return clip(r, room);
}

/** How tall each kind of place stands (m), for where a falling item comes to rest. */
export const ZONE_HEIGHT = Object.freeze({ bed: 0.5, cot: 0.8, desk: 0.76, sofa: 0.45, exit: 0 });

/**
 * The tilt (radians) at which a toppling item comes to rest: flat on the floor (π/2), or earlier
 * if its front face meets the top edge of a bed, desk or sofa standing in the way. An item
 * pivoting on its front edge touches an edge at distance s and height h when tan(tilt) = s / h.
 */
export function restingTilt(it, room, forwards) {
  const f = footprint(it);
  const dir = facing(it.rotation);
  const sgn = forwards ? 1 : -1;
  let best = Math.PI / 2;
  for (const z of room.zones) {
    const h = ZONE_HEIGHT[z.kind];
    if (!(h > 0)) continue;
    let s, sideways;
    if (dir.x === 0) {
      const ahead = sgn * dir.y > 0;
      s = ahead ? z.y - (f.y + f.depth) : f.y - (z.y + z.depth);
      sideways = Math.min(z.x + z.width, f.x + f.width) - Math.max(z.x, f.x);
    } else {
      const ahead = sgn * dir.x > 0;
      s = ahead ? z.x - (f.x + f.width) : f.x - (z.x + z.width);
      sideways = Math.min(z.y + z.depth, f.y + f.depth) - Math.max(z.y, f.y);
    }
    if (sideways <= 0.05 || s < 0 || Math.hypot(s, h) >= it.height) continue;
    best = Math.min(best, Math.atan2(s, h));
  }
  return best;
}

function overlap(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const d = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
  return w > 0 && d > 0 ? w * d : 0;
}

/** The standard normal distribution function: the same series the core uses. */
export function ncdf(x) {
  if (x < -9) return 0;
  if (x > 9) return 1;
  const z = x * x;
  let term = x;
  let sum = x;
  for (let n = 3; n < 400; n += 2) {
    term *= z / n;
    sum += term;
    if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
  }
  const v = 0.5 + sum * Math.exp(-z / 2) * 0.3989422804014327;
  return Math.min(1, Math.max(0, v));
}

/** Chance of toppling at a peak ground acceleration (g), from a fitted lognormal curve. */
export function chance(curve, pga) {
  if (!curve || !(pga > 0) || curve.median >= 1e8) return 0;
  if (curve.beta <= 0) return pga >= curve.median ? 1 : 0;
  return ncdf(Math.log(pga / curve.median) / curve.beta);
}

/** The share of topples that go forwards, near a given strength (the nearest levels with any topples). */
export function forwardShare(curve, pga) {
  let best = null;
  for (let i = 0; i < curve.levels.length; i++) {
    if (curve.topples[i] === 0) continue;
    const d = Math.abs(Math.log(curve.levels[i] / pga));
    if (best === null || d < best.d) best = { d, share: curve.forwards[i] / curve.topples[i] };
  }
  return best ? best.share : 1;
}

/**
 * One item's risk in a given strength of shaking: the chance it falls, where it would land, and
 * the chance it lands on each place people spend time (or across the doorway).
 */
export function assess(room, it, curve, pga) {
  const p = it.anchored ? 0 : chance(curve, pga);
  const fwd = forwardShare(curve, pga);
  const hits = [];
  let harm = 0;
  for (const z of room.zones) {
    let share = 0;
    for (const [forwards, weight] of [[true, fwd], [false, 1 - fwd]]) {
      if (weight <= 0) continue;
      const land = landing(it, room, forwards);
      const area = overlap(land, z);
      // If a quarter of the fallen item (or of the place, if smaller) lies on it, count it as a hit.
      if (area > 0) share += weight * Math.min(1, area / Math.min(z.width * z.depth, land.width * land.depth) / 0.25);
    }
    const ph = p * Math.min(1, share);
    if (ph > 0) {
      hits.push({ zone: z, chance: ph });
      const k = ZONE_KINDS[z.kind];
      // The weight of a falling item matters: energy released, mass × g × centre-of-mass height.
      const energy = it.mass * 9.81 * LOADS[it.load] * it.height;
      harm += ph * (k.hours / 24) * k.weight * energy;
    }
  }
  return { item: it, chance: p, hits, harm, blocksExit: hits.some((h) => h.zone.kind === 'exit') };
}

/**
 * The plan: every item's risk, ranked by harm (then by chance of blocking the door, then of
 * falling), and what to do about each. `lowered` gives an optional curve for the item with its
 * heavy things moved low.
 */
export function plan(room, curves, pga, lowered = {}) {
  const rows = room.items.map((it) => {
    const a = assess(room, it, curves[it.id], pga);
    let action;
    if (it.anchored) action = { kind: 'anchored', text: 'Already anchored.' };
    else if (a.chance < 0.02) action = { kind: 'fine', text: 'Stays put in this shaking.' };
    else if (a.harm > 0 || a.blocksExit) {
      action = { kind: 'anchor', text: it.mass > 40 ? 'Anchor it to a wall stud with two straps or L-brackets.' : 'Anchor it to the wall with a strap.' };
    } else {
      const low = lowered[it.id] ? chance(lowered[it.id], pga) : null;
      action = low !== null && low < a.chance * 0.5 && it.load !== 'low'
        ? { kind: 'lower', text: `Move heavy things to the bottom: the chance it falls drops to ${pct(low)}.`, chance: low }
        : { kind: 'anchor', text: 'Anchor it: it falls clear of people, but it can still break or block the room.' };
    }
    return { ...a, action };
  });
  rows.sort((a, b) => b.harm - a.harm || Number(b.blocksExit) - Number(a.blocksExit) || b.chance - a.chance);
  return rows;
}

/** The chance that at least one item lands on a place (treating items as independent). */
export function chanceAny(rows, kind) {
  let none = 1;
  for (const r of rows) for (const h of r.hits) if (h.zone.kind === kind) none *= 1 - h.chance;
  return 1 - none;
}

/** Expected number of items that fall. */
export function expectedFalls(rows) {
  return rows.reduce((s, r) => s + r.chance, 0);
}

export function pct(p) {
  if (p <= 0) return '0%';
  if (p < 0.01) return 'under 1%';
  if (p > 0.99) return 'over 99%';
  return `${Math.round(p * 100)}%`;
}

/** A plain-text checklist to print or keep, from a plan. */
export function checklist(room, rows, intensity) {
  const lines = [`Stayput checklist: ${room.name}`, `For ${intensity.name.toLowerCase()} shaking (intensity ${intensity.id}), floor ${room.floor} of ${room.storeys}.`, ''];
  let n = 0;
  for (const r of rows) {
    if (r.action.kind === 'fine' || r.action.kind === 'anchored') continue;
    n++;
    const where = r.hits.length ? `; lands on: ${r.hits.map((h) => `${h.zone.name} (${pct(h.chance)})`).join(', ')}` : '';
    lines.push(`${n}. ${r.item.name}: falls ${pct(r.chance)}${where}.`, `   ${r.action.text}`);
  }
  if (n === 0) lines.push('Nothing needs doing for this strength of shaking.');
  lines.push('', 'Straps and brackets only work screwed into a stud or solid wall, not plasterboard alone.');
  return lines.join('\n') + '\n';
}
