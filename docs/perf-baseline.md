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

| Item | Value |
| --- | --- |
| `app/globals.css` source | 98,448 B / 741 lines (was 105,864 B / 759 lines before the P0 dead-code pass) |
| Compiled CSS | 73.9 kB raw → **14.1 kB gz** (single file, no splitting) |
| Rule blocks | 716 (measured before the P0 pass) |
| Literals | 1,079 px, 120 hex colours, 73 rgba(), 99 `border-radius`, 102 type declarations, 25 durations, 27 `cubic-bezier` (only 3 distinct curves), 13 `!important`, 17 ad-hoc z-index values |
| Expensive properties | 35 `backdrop-filter`, 58 `box-shadow`, 24 `mask`, 4 `contain`, 0 `will-change` |

## Source size

| File | Lines |
| --- | --- |
| `app/page.tsx` | 1,270 (was 1,322 before P0) |
| `app/globals.css` | 741 |
| `lib/glassWebgl.ts` | 1,141 |
| `lib/inkSampler.ts` | 492 |
| `lib/glassEdge.ts` | 428 |
| `app/settings-view.tsx` | 268 |
| `app/bottom-pill.tsx` | 240 |

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

## Budget (proposed; warning first, gate later)

| Metric | Budget |
| --- | --- |
| First Load JS on `/` | ≤ 123 kB now; ≤ 95 kB after P3 code-splitting |
| Largest route chunk | ≤ 40 kB |
| CSS (gz, one file) | ≤ 16 kB |
| Interaction (scroll / drag) p95 | ≤ 20 ms |
| Long tasks | 0 over 50 ms during scroll, playback, or a slider drag |
| Glass slider step (4 panes) | ≤ 25 ms |

## How to re-measure

1. Build locally: `./node_modules/.bin/next build` (never `npx`, never a temp copy — both have
   emptied `node_modules` on this machine before).
2. Read the route table it prints, and the gz sizes with
   `gzip -c <file> | wc -c`.
3. Runtime numbers need the isolated dev instance on `:3001` with a scratch `AUTH_DATA_DIR`
   (the `:3000` container holds real data — never point a probe at its volume).
4. Anything touching the glass material also needs the pixel probes (decoded displacement map,
   linear-ramp inversion, chirality test) before the phase can be called done.
