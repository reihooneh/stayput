// How it works: the live size-effect check.

import { $, clear, el, simulator } from './dom.js';

const heights = [0.4, 0.8, 1.6, 2.6];

async function main() {
  const sim = simulator();
  const items = heights.map((h) => [(0.3 * h) / 1.9, h, 0.5, 0.6, 0, Math.PI / 2]);
  const res = await sim.run({ items, records: 24, storeys: 1, floor: 0, soil: 'firm' });
  const medians = res.curves.map((c) => c.median);
  const body = clear($('#size-check tbody'));
  heights.forEach((h, i) => {
    const m = medians[i];
    body.append(el('tr', {}, el('td', { text: `${h.toFixed(1)} m` }), el('td', { class: 'num', text: m >= 1e8 ? 'never, up to 1.2 g' : m > 1.2 ? 'over 1.2 g' : `${m.toFixed(2)} g` })));
  });
  const rising = medians.every((m, i) => i === 0 || m >= medians[i - 1]);
  $('#size-verdict').textContent = rising
    ? `No larger box toppled more easily than a smaller one: the size effect holds (${(res.ms / 1000).toFixed(1)} s of simulation).`
    : 'The sizes did not come out in order this time.';
}

main()
  .catch((e) => ($('#size-verdict').textContent = `The check could not run: ${e.message}.`))
  .finally(() => (document.body.dataset.ready = 'true'));
