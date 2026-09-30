# The glass's GPU cost, measured

Measured **2026-09-30** on the target machine: Intel i7-12700F + **AMD Radeon RX 590**, macOS,
Chrome, one tab at 1440×900 with `deviceScaleFactor: 2`, the documented default glass settings
(blur 12 px, clarity 60, edge 9, refraction 30) on the `:3001` dev instance.

## The instrument

```bash
# one sample per 0.25 s; the device-wide figure, not Chrome's own
ioreg -r -c IOAccelerator -d 1 -w 0 | grep -o '"Device Utilization %"=[0-9]*' | grep -o '[0-9]*$' | sort -rn | head -1
```

Four things about it, all of which shape how the numbers must be read:

- It is **device-wide**, not per process: macOS offers no per-client GPU attribution
  (`powermetrics` needs root, which is unavailable here). Attribution is therefore by **A/B delta
  within one session** — the same machine, the same foreground app, only the page state changed.
- **Use the median.** The mean is inflated by spikes from whatever else is on screen (the
  assistant's own window, WindowServer — measured at 50 % + 28 % CPU during these runs); those
  spikes land in every arm and cancel in the medians, not in the means.
- The floor is **4 %**: Chrome sitting on `about:blank` measures median 4 %, mean 15.5 %.
- A blank-page arm and an app arm must be taken **back to back**; the machine drifts.

## What was measured

| state | median | mean | what it says |
| --- | --- | --- | --- |
| Chrome on `about:blank` | **4 %** | 15.5 % | the floor: the machine plus an idle browser |
| studio, idle, as shipped | **99 %** | 71.7 % | **the idle budget (≤5 %) is missed by ~19×** |
| studio, idle, orbs static | **5 %** | 20.1 % | the orbs' animation is the whole of it |
| studio, idle, every animation paused | **4 %** | 17.8 % | nothing else animates |
| playing, as shipped | **99 %** | 76.2 % | the real-time budget (≤30 %) is missed by ~3.3× |
| playing, orbs static | **27 %** | 39.4 % | the transport's own cost |
| playing, orbs static, bar rim displacement off | 19 % | 38.8 % | the bar's displacement is ~8 points of it |
| playing, orbs static, **all backdrop-filters off** | **4 %** | 12.2 % | the rest is the panes re-blurring |
| orbs animating, `filter: blur()` removed | 99 % | 75.9 % | the cost is not the blur |
| orbs animating, lifted above the panes | 54 % | 67.5 % | half is the panes re-blurring behind them |
| **the same drift, stepped once a second** | **5 %** | 8.6 % | and this is the fix, measured |

## What the numbers mean

1. **Idle is 99 % because two large blurred layers drift behind the glass, forever.** `.ambient-orb`
   is 440 px and 480 px with `filter: blur(72px)`, animated by `translate` + `scale` on a 22 s and a
   27 s loop. Every frame they move, the content behind every `backdrop-filter` pane changes, so
   every pane re-blurs — and the layers themselves are repainted. Neither half is free:
   - removing the blur changes nothing (99 % → 99 %): it is the *movement*, not the filter;
   - lifting the orbs above the panes removes about half (99 % → 54 %): that half was the panes;
   - stopping the movement removes all of it (99 % → 5 %).
2. **Playback costs ~23 points, and it is not the transport's animations.** With the orbs static,
   hiding the bar's seek row, killing the ring pulse and stopping the cover's spin changed nothing
   (27 % → 20-21 %, i.e. noise). Turning the backdrop-filters off dropped it to 4 % — so the cost is
   the panes being re-rendered, and what drives that is the **4 Hz clock**: four DOM writes a second
   inside a pane invalidate the panes, and the ink sampler's `MutationObserver` (childList) reacts to
   each of them with a full tick that writes `--ink-mix` / `--glass-shade` on every pane.
3. **The bar's `data-glass-edge="3"` costs ~8 points while something is repainting it** — 27 % → 19 %
   with its displacement chain removed. It is not a fixed cost: with the clock quiet, the bar stops
   being repainted and the rim goes with it.

## The plan

Ordered by measured value per unit of risk. **Nothing here is implemented yet.**

### A. The backdrop stops moving continuously — 99 % → ~5 % idle (the whole idle budget)

Pick one; the difference is the visual:

| option | idle median | what is lost |
| --- | --- | --- |
| freeze the orbs (`animation: none`) | 5 % | the slow drift of the two colour clouds — the studio becomes still |
| **step the drift** (one transform write per second, or one per two seconds) | **5 %** | almost nothing: at a 1-2 px step the movement is a slow creep rather than a glide. Measured at 5 % with 60 px steps, so the cost is per *change*, not per distance — smaller steps cost the same |
| animate only while the user is interacting | 5 % at rest | idle is free, but scrolling then carries the drift's cost |

Measured on the stepped variant: **5 % median, 8.6 % mean** — the drift survives and the budget is met.

### B. The clock stops invalidating the panes — 27 % → under 10 % during playback (estimated)

Three candidate changes, all small, to be measured one at a time:

1. **The labels update once a second, not four times.** `m:ss` cannot be read faster than that; the
   seek hairline keeps its 4 Hz cadence through a **style write** (`--seek`), which does not fire the
   sampler's `childList` observer the way a text write does.
2. **The sampler coalesces its reaction.** `markMoved` currently re-stamps on every mutation; a short
   debounce (or ignoring mutations that only touch panes' own clocks) keeps a 4 Hz UI from driving a
   4 Hz full tick.
3. Re-measure the bar's rim displacement afterwards: it was 8 points *while* the bar was being
   repainted 4×/s, and may need no change at all once (1) and (2) land.

### C. Re-measure, then decide about the surfaces not yet covered

The now-playing view (open, with the sheet up), the phone layout with the pill, the video overlay
playing, and a settings drag are all heavier than the states measured here and none of them has been
measured. Each gets the same instrument and an A/B against the arm above it.

### D. Keep it from coming back

The instrument is macOS-only, so it cannot run in CI. It belongs with the other manual probes in
`docs/perf-baseline.md`: the exact command, the blank-page floor, and the two budgets (idle ≤ 5 %,
real-time ≤ 30 %), so the next person can reproduce the table above in ten minutes.
