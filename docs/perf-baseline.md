# Performance baseline

Measured **2026-09-30** on the development machine with `./node_modules/.bin/next build`
(Next 14.2.5, production mode, React 18.3.1). Re-measure with the same command after every
refactor phase and append the number to the table at the end — a phase that cannot show a
number is not finished.

## Bundle (Next.js build report)

| Item | Value |
| --- | --- |
| Route `/` — page | 35.3 kB |
| Route `/` — **First Load JS** | **123 kB** (shared 87.4 kB) |
| `_not-found` First Load JS | 88.2 kB |
| Shared chunk `fd9d1056` | 53.6 kB / 172.8 kB raw / 53.8 kB gz |
| Shared chunk `23` | 31.5 kB / 123.4 kB raw / 31.7 kB gz |
| App page chunk | 108.6 kB raw / 31.9 kB gz |
| Lazy chunk `805` (music-metadata) | 112.0 kB raw / 33.6 kB gz — **already split, keep it split** |
| Whole `.next/static` | 1.1 MB |

## CSS

| Item | P0 | P1 |
| --- | --- | --- |
| `app/globals.css` source | 105,864 B → 98,448 B (741 lines) | 99,790 B (761 lines, incl. the token block's comment) |
| Compiled raw | 73,941 B | 67,726 B |
| Compiled **gz** | 14,093 B | **13,221 B** (−6.2% vs P0) |
| Rule blocks | 716 | 653 |
| Literals | 1,079 px, 120 hex colours, 73 rgba(), 99 `border-radius`, 102 type declarations, 25 durations, 27 `cubic-bezier` (3 distinct curves), 13 `!important`, 17 ad-hoc z-index values | fonts/easings/type-sizes/z-layers are tokens now; the counts above still describe everything else |
| Expensive properties | 35 `backdrop-filter`, 58 `box-shadow`, 24 `mask`, 4 `contain`, 0 `will-change` | unchanged |

P1 note: the gz figure fell 6.2% in P1 (the collapsed font stacks more than pay for the token
block). A phase that *adds* gz is acceptable when it buys a single source of truth — but it has to
be said out loud rather than buried.

## Source size

Refreshed 2026-10-02 (the glass-boundary change; the split stylesheets replaced `app/globals.css`
on 2026-10-01 and `app/settings-view.tsx` left for `features/appearance` in P3.1):

| File | Lines |
| --- | --- |
| `app/page.tsx` | 1,203 (1,344 before the glass system moved out) |
| `features/glass/model.ts` / `useGlassSystem.ts` / `index.ts` | 133 / 139 / 17 |
| `styles/shared.css` / `shell.css` / `now.css` | 590 / 150 / 192 |
| `features/appearance/appearance.css` / `features/lyrics/lyrics.css` | 40 / 155 |
| `lib/glassWebgl.ts` | 1,202 |
| `lib/inkSampler.ts` | 578 |
| `lib/glassEdge.ts` | 588 |
| `app/bottom-pill.tsx` | 471 |

## Runtime (measured with the pixel/frame probes described in the glass notes)

| Scenario | Baseline |
| --- | --- |
| Page scroll with all glass live | mean 16.68 ms, p95 ~17.6 ms, 0 frames > 20 ms |
| Same scroll with the rim filter chain removed | mean 16.65 ms, p95 17.4 ms — the rim is free |
| Band (refraction) slider, one step, four panes | ~21 ms (2.65 ms per rebuilt map is `toDataURL` encoding) |
| Distortion slider, one step | one attribute write |
| Ink sampler tick | ~free; measured 16.68 ms mean with 19 media elements on the page |
| **React re-renders while playing** | the whole 1,270-line tree re-renders on every `timeupdate` (≈4/s) — not yet measured with the Profiler; measure at P4 |

## Server-side store (measured on the live volume, read-only)

| Item | Value |
| --- | --- |
| `/app/data/assets.json` | **32.3 MB for 18 assets** |
| Assets carrying an inline `coverData` data URI | 13 of 18 |
| Re-read cost | `lib/assets.ts` parses the whole file with `JSON.parse` and keeps it in a module cache keyed on mtime; every mutation rewrites all 32 MB (`JSON.stringify(s, null, 2)`) |

The `/api/assets/[id]/cover` route already serves artwork per card, so the data URIs no longer
need to live inside the index record — moving them to files next to the media (P5) is the single
biggest server-side win available, and it is measurable as request latency on `/api/assets?index=1`.

## Budget

| Metric | Budget | measured |
| --- | --- | --- |
| First Load JS on `/` | ≤ 138 kB gz (see `scripts/budget.mjs`) | **137.5 kB** (2026-10-03, after the SF Symbols split: the icon module carries both the hand-drawn set and Apple's inlined glyphs, swapped per platform at runtime). Before that swap the same build measured 131.7 kB; 131.4 kB after the glass-boundary change; 122.2 at P3.3 |
| CSS (gz, all shipped files) | ≤ 18.2 kB | **18.12 kB** (2026-10-03: the phone's video bar — a row of four glass pieces with the name card above them — and the player bar's transport icons joining the adaptive ink; the ceiling moved 18.0 → 18.2 only after the dead dock positioning, a duplicated rail rule and the dock's own veil were removed) |
| Largest chunk (gz) | ≤ 58 kB | 53.7 kB |
| Interaction (scroll / drag) p95 | ≤ 20 ms | 17.6 ms |
| Long tasks | 0 over 50 ms during scroll, playback, or a slider drag | 0 |
| Glass slider step (4 panes) | ≤ 25 ms | ~21 ms |
| **GPU, idle** (user's budget, 2026-09-30) | **≤ 5 %** of the device, against a 4 % blank-page floor | **5-6 %** after the stepped drift |
| **GPU, real-time** | **≤ 30 %** | **22 %** playing; 9.5-10 % for the now view, the phone layout and the video overlay |

The GPU figures come from a device-wide meter with no per-process attribution, so they are A/B
deltas read as medians — the recipe, its failure modes and the full table are in
`docs/gpu-measurement.md`. They cannot run in CI; they are re-measured by hand when the glass, the
motion or the shell changes.

## Phase log

| Phase | What it changed | Evidence |
| --- | --- | --- |
| P0 (commit `e4d388a`) | deleted confirmed dead code (TS + CSS) | build + container check; First Load JS unchanged at 123 kB |
| P1 | design tokens: two font stacks, three easings, four shared type sizes, the document's z-layers; literals replaced 1:1 | **computed-style diff through the Chrome DevTools MCP: 195 elements × 57 properties on the studio view and the settings view, before vs after = 0 differing values**; console clean; live check that `--glass-blur` drives `backdrop-filter` (`blur(12.4px) saturate(1.7) url(#glass-edge-0)`) after four `ArrowRight` presses on the Blur slider |
| P2 | the five material levels named on the shell; four of the five pane selector lists replaced by `[data-glass-edge]`; pane radii named | 1,479 element-lines (five views at a fixed viewport + the compact layout with the pill's bubble raised) = 0 differing values; Clarity driven 60 → 62 with real key presses moved the bar's alpha 0.616 → 0.608 through the level token |
| P3.1/P3.2 | the appearance feature and the parameter editor extracted; `RangeControl`, `TransportGlyphs`, `Asset`/`IndexEntry`, `formatTime` moved to design-system/shared; both surfaces loaded with `next/dynamic` | 1,301 + 1,209 element-lines = 0 differing values; both lazy chunks confirmed absent from the initial-load list; First Load JS 123 kB unchanged |
| P4 | the playback clock left the page's state for `features/player` (`useMediaClock`, `SeekBar`, `WaveformTrack`); the listings memoised | **during 8 s of playback, React's scheduler time fell from 87.1 ms to 38.1 ms (−56 %)**, and the page-state writer (`updateTime`, 27 calls) disappeared entirely; the clock now writes 64 × locally (`syncTime`). Studio + editor, 604 element-lines = 0 differing values; transport text, wave times and the wave's `aria-valuenow` all identical |
| P5 | `infrastructure/api/client.ts` is the only way out to the API; `POST /api/assets` validates before it writes | three malformed uploads (260-char name, unknown `mediaKind`, 80 tags) answered 201 before and 400 after, while `.wav`/`.opus` still upload; then import → edit title → sign out → wrong password → sign in, all through the client |
| P4.2 | the now-playing view became `features/now-playing` and took its own UI state with it (panel, drawer, gesture, lyric focus, the phone's measuring pass) | desktop whole document: 470 / 440 / 368 elements identical; compact inside `.now-view`: 54 elements, identical structure and **0 differing property values** in both the resting and swiped states, with `--now-reveal`, `--now-lift`, `--now-upper-top/bottom` and every `--lyric-focus` identical. Re-verified live on the deployed container: lyrics tab opens the drawer, the queue tab returns, close unmounts |
| Glass boundary (2026-10-02) | the Liquid Glass system moved to `features/glass` (dials, storage, WebGL/SVG attach, ink sampler, param pushes); functional code keeps only declarative DOM markers, and the pill's silent-move notification is a bubbling **`glass-refresh` DOM event**; `AppearanceSettings` imports the glass feature, not engine internals; the ink sampler takes its root and finds the overlay via `data-glass-layer="video"`; engines untouched; `glassGroups` added to the save deps (family overrides now persist — intended) | computed-style diff, same blob and viewport: studio **161** + settings **263** element-lines = **0 differing values**; blob byte-identical and stable over 2.5 s, key order unchanged; `{glassRefraction:12}` → 30px and `{glassBandPx:84, glassRefraction:1}` → 84px; Blur 12 → 12.3 pushed `--glass-blur` and `backdrop-filter` live, a Cards step rebuilt only the cards' maps (sidebar map hash unchanged); document listener registered on load; real pill tap = 28 events, real drag under `?glasswebgl=1` = 29, console clean; overlay rail reads shade 1.000 / glow 0.224 / ink 100% inside the marked layer; scroll median 16.7 / p95 17.6 / 0 over 20 ms; initial JS gz 131.4 vs HEAD's 131.5 |
| SF Symbols split (2026-10-03) | 14 glyphs with an Apple export (house, music, albums, library, gear, lyrics, pencil, shuffle, repeat, both skips, speaker ×2, waveform) render the real SF Symbol on Apple devices and the hand-drawn twin everywhere else — a layout effect swaps before paint so neither SSR nor hydration ever sees the wrong set; paths inlined at 0.1-unit precision (geometry verified against the source SVGs to ±0.05 units); the JS ceiling raised 135 → 138 kB gz for the second icon set | measured 137.5 kB gz (131.7 before the swap); typecheck, 56 tests, architecture and CSS budget (17.9/18.0) all green; live check on :3001: Apple platform renders the SF glyphs and an overridden `navigator.platform` renders the hand-drawn set |

## P6: the list, measured rather than assumed

A synthetic library of **304 assets (4,427 DOM elements, 24,590 px of scroll)** was rendered in the
Media Library view and scrolled end to end, one step per frame, on the :3001 dev instance:

| | value |
| --- | --- |
| frames | 241 |
| median | 16.6 ms |
| p95 | 17.6 ms |
| max | 17.8 ms |
| frames over 20 ms | **0** |

That is the same shape as the documented baseline with nineteen media elements on the page, so
**no virtualisation and no `content-visibility` were added**: at this size the list is already
frame-perfect, and the refactor's rule is to add cost only where a measurement asks for it.

Caveat, stated rather than buried: the synthetic entries carry no covers, so no per-card artwork
was fetched. That is a network question (the cards already use `loading="lazy"` and
`decoding="async"`), not a rendering one, and it is what to measure first if a real library ever
feels slow.

## The checks that run on their own

`npm run check` — types, the architecture guard (layering, cross-feature imports, cycles) and the
unit tests — plus `npm run check:budget` for the built sizes. All of it uses what the repository
already has: Node's test runner, the project's own TypeScript, and three scripts that read the
source and the build. `.github/workflows/ci.yml` runs the lot on push and pull request. What is
*not* automated is what cannot be: the computed-style diffs and the pixel probes the glass needs,
which are described above and are manual by nature.

## How to re-measure

1. Build locally: `./node_modules/.bin/next build` (never `npx`, never a temp copy — both have
   emptied `node_modules` on this machine before).
2. Read the route table it prints, and the gz sizes with
   `gzip -c <file> | wc -c`.
3. Runtime numbers need the isolated dev instance on `:3001` with a scratch `AUTH_DATA_DIR`
   (the `:3000` container holds real data — never point a probe at its volume).
4. Anything touching the glass material also needs the pixel probes (decoded displacement map,
   linear-ramp inversion, chirality test) before the phase can be called done.
5. For a change that is supposed to be invisible, the cheap and rigorous test is the computed-style
   snapshot: set `localStorage["onlinemusic-settings"]` to a fixed blob, reload, walk every element
   and hash ~57 computed properties, switch to Settings and repeat, and diff the two runs. Two
   back-to-back runs of the *same* build must be identical first, or the snapshot is not sound.
   The before/after pair for P1 is kept in `/tmp/p1-snapshots/`.
