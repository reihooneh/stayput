# How Stayput works

This file covers the design, the physics in plain words, the trade-offs, and the questions an interviewer is likely to ask.

## 1. Architecture

```
room file / editor ──checkRoom──▶ room (items, places, building, soil)
        │
        ├──▶ Web Worker ──▶ WebAssembly core (C)
        │                    ├─ sp_ground   synthetic earthquakes (two directions)
        │                    ├─ sp_floor    the building's sway → motion on your floor
        │                    ├─ sp_run      Housner rocking / sliding of one item
        │                    └─ sp_room     Monte Carlo: records × 16 strengths × items → lognormal fit
        │                 ◀── fragility curve per item
        │
        ├──▶ model.js: chance at the chosen intensity, landing strips, hits, harm, the plan
        ├──▶ plan2d.js (SVG floor plan)   charts.js (SVG curves)
        └──▶ engine.trace for one earthquake ──▶ scene3d.js (three.js, each item pivoting on its edge)
```

The C core does the numbers, the JavaScript does the room and the pictures, and a worker keeps the page responsive while thousands of rocking simulations run.

## 2. File tour

| Path | What it holds |
|---|---|
| `core/stayput.h` | Every type and function of the core, with units |
| `core/maths.c` | Sine, cosine, exp, log, atan, the normal distribution, and the PCG32 generator: no C library is needed in WebAssembly |
| `core/motion.c` | Kanai–Tajimi and Clough–Penzien filters, the envelope, a 20 Hz low-pass; the yielding building oscillator |
| `core/rock.c` | `sp_run`: rest, rocking (RK4), impacts, the wall, sliding, toppling and falling to the floor |
| `core/fragility.c` | `sp_room` (the Monte Carlo) and `sp_fit` (maximum likelihood) |
| `core/wasm.c` | The exported functions, fixed buffers, and checks on every argument |
| `src/web/model.js` | The room format and its strict checker, landing strips, resting tilt, harm, the plan, the checklist |
| `src/web/engine.js` | A checked JavaScript wrapper round the WebAssembly exports (works in a page, a worker and Node) |
| `src/web/worker.js` | The simulation worker |
| `src/web/scene3d.js` | The 3D room: furniture models, pivots, shaking, resting on beds |
| `src/web/plan2d.js` | The draggable, keyboard-accessible floor plan |
| `src/web/{home,room,shaking,method}.js` | One script per page |
| `scripts/build.mjs` | Builds `site/`: layout, CSP, self-hosted three.js and fonts |
| `tests/core/test_core.c` | The C tests: maths, physics against theory, size effect, fit, random and bad inputs |
| `tests/engine/model.test.mjs` | The room model, hostile files, the WebAssembly interface |
| `tests/web/site.test.mjs` | Playwright: every page at three sizes, the features, the CSP |

## 3. Key ideas, simply

**A bookcase is a block that rocks.** Push the floor sideways and a tall bookcase doesn't slide: it rocks on one bottom edge. It only starts rocking when the floor accelerates faster than *g* times its half-depth over the height of its centre of mass (*g* tan α). That is why slim, top-heavy things go first. Once rocking, gravity pulls it back unless it tilts past α, when its centre of mass is beyond the edge and it falls.

**It loses energy every time it lands.** When a rocking block comes back down onto its base it switches edges, and some of its spin is lost in the impact. Housner worked out how much from conservation of angular momentum: for a uniform box, it keeps 1 − 1.5 sin²α of its spin. That is why rocking dies out, unless the shaking keeps feeding it.

**Bigger is safer, even at the same shape.** A big box rocks slowly (its frequency parameter is p = √(3g / 4R)), so the shaking reverses direction before it gets far. A tiny box of the same proportions can be knocked over by a single sharp jolt. The "How it works" page runs this live.

**Upper floors shake harder.** A building is a big spring. Its own sway, with a period of about 0.1 s per storey, adds to the ground's motion, and more so the higher you are. Real buildings yield in strong shaking, which caps that sway, so the oscillator's spring yields at 0.35 g. Without that, upper floors would be wildly over-predicted.

**Monte Carlo gives a probability, not a story.** One earthquake is luck: the same bookcase may survive one record and fall in the next. So each item is shaken by 24 earthquakes at each of 16 strengths. The share that topple it at each strength is fitted with a lognormal curve (the standard "fragility curve" of earthquake engineering) by maximising the binomial likelihood. Any strength can then be read off the curve.

**Harm depends on where it lands.** The plan ranks items by: the chance it falls onto a place people use × how many hours they are there × the energy it falls with. A cot counts double, because a child can't get out of the way. Then come items that would block the door, then everything else. Anchoring an item makes its chance zero, and the page shows how the risk to the bed drops with each step.

**Same code, two builds.** The C core is compiled natively for the tests, with sanitizers, and to WebAssembly for the site. It brings its own maths, so both builds give the same numbers, and the tests check that maths against the C library.

## 4. Trade-offs

- **2D rocking, not 3D.** Real furniture can tip sideways and twist. Most tall furniture is narrow front to back, so its depth is the axis that matters. Modelling 3D rocking (with contact on corners) would be several times the code and the computing, for a small change in the answer.
- **Synthetic, not recorded, earthquakes.** Recorded earthquakes are more realistic, but there are few of them for each soil type, and they bring licensing questions. Filtered noise with the right frequency content and envelope is the standard way to generate many consistent ones, and it keeps the site self-contained.
- **A single-mode building.** One yielding oscillator captures the main effect (upper floors shake harder, then the structure caps it) without asking for anything but the number of storeys.
- **24 records, not 1,000.** Fewer records make each curve noisier, but the lognormal fit smooths them, and a full room reruns in under a second. That matters more on a page that reruns on every change.
- **A worker, not the main thread.** The main thread runs only single earthquakes for the animation. The Monte Carlo runs in a worker, so dragging furniture never stutters.

## 5. Interview questions you might get

**Q: Why write the core in C and compile it to WebAssembly instead of using JavaScript?**
A: The Monte Carlo runs hundreds of thousands of time-stepped simulations per room (24 records × 16 strengths × up to 24 items × 3,000 steps × 4 sub-steps, each a Runge–Kutta step). C in WebAssembly runs this in under a second, predictably. It also lets the same code be tested natively under AddressSanitizer and UBSan. With no C library, the module is 13 KB with fixed memory, and every export re-checks its arguments.

**Q: How do you know the physics is right?**
A: Each part is tested against an answer worked out independently:
- the threshold *g* tan α, exactly;
- Housner's restitution and frequency formulas;
- sliding distance against working it out by hand;
- the building's resonance against the oscillator's steady-state formula;
- the fit recovering a curve I generated counts from.

Then there are behaviours the physics must show, for example that bigger blocks of the same shape topple less, that a wall behind removes backward falls, and that upper floors are more dangerous. The method page reruns the size-effect check live in the browser.

**Q: Why a lognormal fragility curve, and how is it fitted?**
A: It is the standard in earthquake engineering: capacity is the product of many uncertain factors, so its logarithm is roughly normal. The data are binomial (k of n records topple it at each level), so I maximise Σ k log Φ(z) + (n − k) log(1 − Φ(z)) with z = ln(x/median)/β. I used a coarse-to-fine grid instead of Newton's method, because the likelihood is flat when nothing (or everything) topples, and Newton steps can run away there. Items that never topple are reported as "never", not given a made-up curve.

**Q: What stops a malicious room file from doing harm?**
A: The page treats a file as data and checks it strictly:
- the size is checked before reading, and it's parsed with `JSON.parse` only;
- only plain objects are allowed, and any unknown key (including `__proto__`) is rejected;
- every number has a type and range check;
- kinds are looked up with `hasOwnProperty`, so `constructor` doesn't resolve to `Object.prototype.constructor`;
- names are limited to a safe character set.

The page never builds HTML from strings and runs under a strict CSP, so even a name that slipped through couldn't run script. The tests try all of these.

**Q: How do you make sure the pages look right on every screen?**
A: The Playwright tests open every page at phone, tablet and desktop sizes and fail on:
- sideways scrolling;
- any two pieces of text (HTML or SVG) overlapping;
- SVG content leaving its chart;
- buttons, inputs, tables, charts or the 3D view overlapping each other.

They also run the features (shaking, editing, anchoring, file import, downloads) and check the page works with WebGL turned off.

## 6. Ideas to extend it

1. **3D rocking and sliding together.** Use the full rigid-body contact model, rocking on corners, for squat items and for shaking at an angle. Test it against shake-table experiments from the literature.
2. **A hazard-aware strength.** Read a location's design peak ground acceleration (for example a 10%-in-50-years value) and integrate the fragility curve over the hazard curve. This gives an annual chance of toppling instead of a single scenario.
3. **Contents and doors.** Model books sliding off shelves, drawers opening and cabinet doors swinging. Plan anchoring and latches together under a budget.
