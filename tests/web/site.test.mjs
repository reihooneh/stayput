// Browser tests for every page at phone, tablet and desktop widths: no errors, no sideways
// scrolling, no text on top of other text (HTML or SVG), and the main things work.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { serve } from '../../scripts/serve.mjs';

const PAGES = ['index.html', 'room.html', 'shaking.html', 'method.html'];
const SIZES = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'phone', width: 390, height: 844 },
];
let server, browser, base;

before(async () => {
  server = await serve();
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open(path, size = SIZES[0], opts = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce', acceptDownloads: true, ...opts });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver Message|WebGL/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  return { page, context, errors };
}

// Every piece of visible text, HTML or SVG: no two different pieces overlap.
async function textOverlaps(page) {
  return page.evaluate(() => {
    const boxes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      const elx = n.parentElement;
      if (elx.closest('.visually-hidden, [hidden], .skip, option, title, select')) continue;
      const cs = getComputedStyle(elx);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (elx instanceof SVGElement) {
        const r = elx.getBoundingClientRect();
        if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
        continue;
      }
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width >= 1 && r.height >= 1) boxes.push({ r, text: n.textContent.trim().slice(0, 40), node: n });
    }
    const out = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        if (a.node === b.node) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > Math.min(a.r.height, b.r.height) * 0.35) out.push(`"${a.text}" overlaps "${b.text}"`);
      }
    }
    return out;
  });
}

// SVG text must stay inside its drawing, and shapes inside a chart must stay inside it too.
async function svgOutside(page) {
  return page.evaluate(() => {
    const out = [];
    for (const s of document.querySelectorAll('.figure svg, .chart-box svg')) {
      const f = s.getBoundingClientRect();
      for (const t of s.querySelectorAll('text, line, rect, polyline, ellipse, circle')) {
        const r = t.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < f.left - 1 || r.right > f.right + 1 || r.top < f.top - 1 || r.bottom > f.bottom + 1) out.push(t.textContent || t.tagName);
      }
    }
    return out;
  });
}

// Controls must not sit on top of each other (buttons, inputs, the 3D view, tables).
async function boxOverlaps(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('main .button, main input:not([type=radio]), main select, main .view, main table, main .chart-box, main .segmented')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    const out = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
        const a = els[i].getBoundingClientRect(), b = els[j].getBoundingClientRect();
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (w > 1 && h > 1) out.push(`${els[i].id || els[i].className} overlaps ${els[j].id || els[j].className}`);
      }
    }
    return out;
  });
}

for (const path of PAGES) {
  for (const size of SIZES) {
    test(`${path} at ${size.name}: no errors, no sideways scroll, nothing overlapping`, async () => {
      const { page, context, errors } = await open(path, size);
      const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(scroll <= 0, `page scrolls sideways by ${scroll}px`);
      assert.deepEqual(await textOverlaps(page), []);
      assert.deepEqual(await svgOutside(page), []);
      assert.deepEqual(await boxOverlaps(page), []);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
}



test('home: a 3D bedroom you can shake, with the live facts', async () => {
  const { page, context, errors } = await open('index.html');
  assert.equal(await page.$eval('#hero-view', (n) => n.dataset.mode), 'webgl');
  await page.waitForFunction(() => /g$/.test(document.getElementById('fact-high').textContent), null, { timeout: 60000 });
  const ground = parseFloat(await page.textContent('#fact-ground'));
  const high = parseFloat(await page.textContent('#fact-high'));
  assert.ok(high < ground, `the 8th floor topples it at weaker ground shaking (${high} < ${ground})`);
  await page.click('label:has-text("IX")');
  await page.click('#shake');
  await page.waitForFunction(() => document.body.dataset.shaken === '1', null, { timeout: 60000 });
  assert.equal(await page.locator('#outcomes li').count(), 5);
  assert.match(await page.textContent('#home-status'), /intensity IX: (nothing toppled|\d of 5 items toppled)/);
  assert.deepEqual(await textOverlaps(page), []);
  await page.click('#another');
  await page.waitForFunction(() => document.body.dataset.shaken === '2', null, { timeout: 60000 });
  assert.match(await page.textContent('#home-status'), /^Earthquake 2 of 24/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('home: works without WebGL', async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      return /webgl/.test(type) ? null : orig.call(this, type, ...rest);
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}index.html`);
  await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 60000 });
  assert.equal(await page.$eval('#hero-view', (n) => n.dataset.mode), 'flat');
  await page.click('#shake');
  await page.waitForFunction(() => document.body.dataset.shaken === '1', null, { timeout: 60000 });
  assert.equal(await page.locator('#outcomes li').count(), 5);
  assert.deepEqual(errors, []);
  await context.close();
});

async function runs(page) {
  return Number(await page.evaluate(() => document.body.dataset.runs ?? 0));
}

test('room: the plan follows the shaking, anchoring and moving, and the downloads work', async () => {
  const { page, context, errors } = await open('room.html');
  await page.waitForFunction(() => document.querySelectorAll('#results tbody tr').length === 5, null, { timeout: 60000 });
  assert.match(await page.textContent('#verdict'), /^In severe shaking, about [\d.]+ of 5 items fall, and the chance something lands on the bed is/);
  const bedChance = async () => (await page.textContent('#verdict')).match(/lands on the bed is ([^,]+?)(,|\.$)/)?.[1];
  const before = await bedChance();
  await page.click('label:has-text("VI")');
  await page.waitForFunction(() => /^In strong shaking/.test(document.getElementById('verdict').textContent));
  await page.click('label:has-text("VIII")');
  // Anchor what the plan says to anchor, and the bed is safe.
  const todo = (await page.$$eval('#anchors li strong', (n) => n.map((x) => x.textContent)))
    .filter((t) => /Anchor it/.test(t))
    .map((t) => t.split(':')[0]);
  assert.ok(todo.length >= 2, `the plan anchors ${todo.join(', ')}`);
  for (const name of todo) {
    await page.click(`#items button:has-text("${name}")`);
    await page.check('#it-anchored');
    // Anchoring changes the plan, not the physics: no rerun is needed.
    await page.waitForFunction((nm) => [...document.querySelectorAll('#results tbody tr')].some((r) => r.textContent.includes(nm) && /Already anchored/.test(r.textContent)), name, { timeout: 60000 });
  }
  assert.ok(before && !(await bedChance()), `with those anchored nothing lands on the bed (was ${before})`);
  // Keyboard moving: select a piece on the plan and nudge it.
  const id = await page.$eval('.plan .item', (g) => g.dataset.id);
  const box0 = await page.$eval(`.plan .item[data-id="${id}"] .body`, (r) => r.getAttribute('x'));
  await page.focus(`.plan .item[data-id="${id}"]`);
  await page.keyboard.press('Shift+ArrowRight');
  const box1 = await page.$eval(`.plan .item[data-id="${id}"] .body`, (r) => r.getAttribute('x'));
  assert.ok(parseFloat(box1) > parseFloat(box0), 'the arrow keys move furniture');
  // Bad edits are refused with a message, and the room stays as it was.
  await page.fill('#it-height', '9');
  await page.dispatchEvent('#it-height', 'change');
  assert.match(await page.textContent('#form-error'), /That change was not made: an item height/);
  const [json] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
  const saved = JSON.parse(readFileSync(await json.path(), 'utf8'));
  assert.equal(saved.name, 'Bedroom');
  assert.equal(saved.items.length, 5);
  const [txt] = await Promise.all([page.waitForEvent('download'), page.click('#checklist')]);
  assert.match(readFileSync(await txt.path(), 'utf8'), /^Stayput checklist: Bedroom\nFor severe shaking \(intensity VIII\)/);
  await page.selectOption('#preset', 'kids-room');
  await page.waitForFunction(() => /cot/.test(document.getElementById('verdict').textContent), null, { timeout: 60000 });
  assert.deepEqual(errors, []);
  await context.close();
});

test('room: hostile files are refused and nothing from them reaches the page', async () => {
  const { page, context, errors } = await open('room.html');
  await page.waitForFunction(() => document.querySelectorAll('#results tbody tr').length === 5, null, { timeout: 60000 });
  const dir = mkdtempSync(join(tmpdir(), 'stayput-'));
  try {
    const put = (name, text) => {
      const p = join(dir, name);
      writeFileSync(p, text);
      return p;
    };
    await page.setInputFiles('#file', put('junk.json', 'not json <script>alert(1)</script>'));
    await page.waitForFunction(() => /not valid JSON/.test(document.getElementById('form-error').textContent));
    await page.setInputFiles('#file', put('html.json', JSON.stringify({ name: '<img src=x onerror=alert(1)>', width: 4, depth: 3, items: [{ kind: 'bookcase', x: 1, y: 0.2, width: 0.8, depth: 0.3, height: 1.9, mass: 50 }] })));
    await page.waitForFunction(() => /room name/.test(document.getElementById('form-error').textContent));
    assert.match(await page.textContent('#form-error'), /Still showing Bedroom/);
    await page.setInputFiles('#file', put('proto.json', '{"width":4,"depth":3,"__proto__":{"isAdmin":true},"items":[{"kind":"bookcase","x":1,"y":0.2,"width":0.8,"depth":0.3,"height":1.9,"mass":50}]}'));
    await page.waitForFunction(() => /unknown setting/.test(document.getElementById('form-error').textContent));
    await page.setInputFiles('#file', put('big.json', `{"x":"${'a'.repeat(40000)}"}`));
    await page.waitForFunction(() => /larger than 32 KB/.test(document.getElementById('form-error').textContent));
    await page.setInputFiles('#file', put('mine.json', JSON.stringify({ name: 'My study', width: 3, depth: 3, storeys: 4, floor: 3, items: [{ kind: 'bookcase', x: 1, y: 0.15, width: 0.8, depth: 0.3, height: 2, mass: 70, backed: true }], zones: [{ kind: 'desk', x: 0.5, y: 0.8, width: 1.2, depth: 0.7 }] })));
    await page.waitForFunction(() => /desk/.test(document.getElementById('verdict').textContent), null, { timeout: 60000 });
    assert.equal(await page.isHidden('#form-error'), true);
    assert.equal(await page.locator('#results tbody tr').count(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(await page.$('img[src="x"]'), null);
  assert.equal(await page.evaluate(() => ({}).isAdmin), undefined);
  assert.deepEqual(errors, []);
  await context.close();
});

test('why things fall: the sliders rerun the curves, and one earthquake plays', async () => {
  const { page, context, errors } = await open('shaking.html');
  assert.match(await page.textContent('#r-tip'), /^\d\.\d\d g$/);
  assert.equal(await page.locator('#curve svg path.line').count(), 4);
  const median = await page.textContent('#r-median');
  const n = await runs(page);
  await page.$eval('#depth', (el) => { el.value = '0.6'; el.dispatchEvent(new Event('input')); });
  await page.waitForFunction((k) => Number(document.body.dataset.runs) > k, n, { timeout: 60000 });
  assert.equal(await page.textContent('#depth-out'), '0.60 m');
  assert.notEqual(await page.textContent('#r-median'), median, 'a deeper bookcase needs different shaking');
  await page.waitForFunction(() => /^Earthquake 1 of 24 at intensity VIII: /.test(document.getElementById('shake-status').textContent), null, { timeout: 60000 });
  assert.equal(await page.locator('#motion svg path.line').count(), 3);
  await page.fill('#floor', '9');
  await page.dispatchEvent('#floor', 'change');
  await page.waitForFunction(() => /floor must be/.test(document.getElementById('form-error').textContent));
  assert.deepEqual(errors, []);
  await context.close();
});

test('how it works: the live size-effect check holds', async () => {
  const { page, context, errors } = await open('method.html');
  await page.waitForFunction(() => /size effect holds|did not come out/.test(document.getElementById('size-verdict').textContent), null, { timeout: 60000 });
  assert.match(await page.textContent('#size-verdict'), /size effect holds/);
  assert.equal(await page.locator('#size-check tbody tr').count(), 4);
  assert.deepEqual(errors, []);
  await context.close();
});

test('the static server refuses paths outside the site', async () => {
  for (const p of ['../package.json', '..%2fpackage.json', '%2e%2e/%2e%2e/etc/passwd', 'assets/../../package.json']) {
    const res = await fetch(base + p);
    assert.notEqual(res.status, 200, p);
  }
});

test('built pages: strict CSP, no inline code, nothing from other sites, no HTML from strings', () => {
  const dir = new URL('../../site/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.html'))) {
    const html = readFileSync(new URL(f, dir), 'utf8');
    assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval';/, f);
    assert.doesNotMatch(html, /'unsafe-inline'|'unsafe-eval'/, f);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${f} has an inline script`);
    assert.doesNotMatch(html, /\sstyle=|<style|\son[a-z]+=/i, `${f} has inline styles or handlers`);
    const external = [...html.matchAll(/(?:src|href)="(https?:[^"]+)"/g)].map((m) => m[1]);
    for (const url of external) assert.ok(/^https:\/\/github\.com\/reihooneh\//.test(url), `${f} links ${url}`);
  }
  for (const f of readdirSync(new URL('assets/js/', dir))) {
    const js = readFileSync(new URL(`assets/js/${f}`, dir), 'utf8');
    assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/, `${f} builds HTML or code from strings`);
    assert.doesNotMatch(js, /from 'three/, `${f} still has a bare import`);
  }
});
