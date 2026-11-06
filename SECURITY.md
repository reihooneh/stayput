# Security

Stayput is a static website. All of its work happens in the visitor's browser: there is no server code, no account, no database, no analytics and no third-party script. The attack surface is small, but not zero, and this is how it is handled. No software is perfectly secure; if you find a problem, please report it (see the end).

## What an attacker could try, and what stops them

| Threat | Defence |
|---|---|
| **A hostile room file** (opened with "Open a room file"), to run script in the page, pollute prototypes, or crash or hang the tab | The file is size-checked before it is read (32 KB), parsed with `JSON.parse` only, and checked by `checkRoom`. Only plain objects are accepted, an unknown key (including `__proto__`) is refused, every number is checked for type and range, and kinds are looked up with `hasOwnProperty`, so `constructor` and `toString` are refused. Names allow only letters, digits and simple punctuation, and limits are enforced (at most 12 items and 8 places). Error messages never repeat the file's contents. |
| **Cross-site scripting** through names shown in the page | The page never builds HTML from strings. Every element is made with `createElement` or `createElementNS` and filled with `textContent`. A test fails the build if `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` or `new Function` appear in the shipped code. |
| **Injected or third-party script** | Every page has a strict Content-Security-Policy: `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'`, nothing inline (no inline scripts, styles or handlers), `base-uri 'none'` and `form-action 'none'`. `'wasm-unsafe-eval'` lets the page compile its own WebAssembly file and nothing else. three.js and the fonts are self-hosted and pinned. The tests check every built page for all of this. |
| **Memory errors in the C core** | The WebAssembly module has fixed memory (4 MB, it never grows) and fixed buffers. Every exported function re-checks its arguments (counts, ranges, finite numbers) and returns an error code instead of writing out of bounds. The native build of the same code runs the tests under AddressSanitizer and UndefinedBehaviorSanitizer, including random and invalid inputs, with `-Wall -Wextra -Wconversion -Werror` and clang-tidy. |
| **A crafted message to the simulation worker** | The worker accepts one message shape. It checks every field (array lengths, finite numbers in range, a known soil) before calling the core. |
| **Denial of service** (a room that makes the simulation run for ever) | The work is bounded by the input limits: at most 24 simulated items, 64 records, 16 strengths and 3,000 time steps. A run takes seconds, and it runs in a worker so the page stays responsive. |
| **Path traversal** in the local preview server (`scripts/serve.mjs`) | It serves only files inside `site/` with a fixed list of content types. Paths are normalised and checked to stay inside the folder, and the tests try `../` tricks against it. The live site is served by GitHub Pages. |
| **Supply chain** | There are no runtime dependencies beyond the vendored, pinned three.js and two font packages. Development dependencies are pinned in `package-lock.json`, and CI runs `npm audit`. The workflow runs with read-only permissions except the Pages deploy job. |

## Privacy

Room files you open are read in your browser and never sent anywhere. Saving a room or downloading a checklist creates the file locally. The site sets `referrer` to `no-referrer`.

## Limits

Stayput is a planning aid, not an engineering assessment. The physics are deliberately simple (see HOW-IT-WORKS.md), and its results should guide what to anchor first, not be used to declare a room safe.

## Reporting a problem

Please open a private security advisory on the GitHub repository (Security → Report a vulnerability), or an issue if the problem is not sensitive. Include what you did and what happened. Fixes are made on `main` and deployed automatically.
