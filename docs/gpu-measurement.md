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

## What was done about it

**A — the drift is stepped** (`lib/ambientDrift.ts`, commit `d870a04`). The keyframes are gone from
the stylesheet; one transform write a second carries the same path, travel and scale, and nothing at
all happens under `prefers-reduced-motion`. **Idle: 99 % → 5-6 %** (four runs), which is the
blank-page floor. Verified in the same session: the orbs take one step a second along the intended
path, and the playing state follows at 22 %.

**B — investigated, not yet changed.** The playback cost is the **seek row**: with the app truly
playing (its own transport, `audio-playing` + `is-playing`, both animations, the clock ticking),
hiding that one row drops the machine from **22 % to 4.0 %** — a within-state A/B, the most
trustworthy comparison this instrument allows. Four writes a second inside `.glass-bar` repaint the
row, and repainting anything inside a `backdrop-filter` pane re-runs that pane's backdrop. Two
things follow, both measured:

- it is **not** the transport's animations, the bar's rim, the sampler or the drift — each was
  removed in turn with no change;
- the obvious remedies **backfire inside a backdrop pane**: `contain: paint` on the row wedged the
  renderer outright (the tab stopped answering and had to be reloaded), and `will-change: transform`
  on it made the cost *worse* (22 % → 52 %). Do not put compositing hints on children of a pane.

What is left, in order of what it costs the design: update the fill less often (a 1 Hz fill ≈ a
quarter of the cost, with a visibly stepping hairline); draw the fill as a transformed element
instead of a gradient driven by `--seek` (keeps 4 Hz, needs the seek row restructured); or take the
row out of the pane. None of them is needed for the budget — 22 % is inside 30 % — so this is
headroom, not a defect.

## C — the surfaces nobody had measured

All at the documented defaults, taken muted, each verified before and after:

| state | median |
| --- | --- |
| desktop, idle | 5-6 % |
| phone layout (390×844@2), idle | 10 % |
| phone, now-playing view open with the sheet up | 10 % |
| desktop, video overlay open | 9.5 % |
| desktop, playing audio | 22 % |

The now view and its sheet cost nothing beyond the phone layout's own idle, and the overlay costs
little more than the desktop's. Two caveats, stated rather than buried: the overlay arm used the
undecodable `.mp4` fixture, so real video decode and texture upload are **not** covered by that
number; and the phone's 10 % sits inside the instrument's wobble around the desktop's 5-6 %, so it
should be re-measured with interleaving before anyone acts on the difference.

## D — how to keep it

**The instrument, again, with its failure modes.** `ioreg -c IOAccelerator`'s "Device Utilization %"
is device-wide, and this machine has **switchable graphics** (Intel iGPU + AMD RX 590): the same app
state read **22 %** and **99 %** at different times, which is the device under the reading changing,
not the app. So:

1. Fix the viewport with the emulator, and pin the glass settings through `localStorage` — an
   unpinned window changed a reading by 4× once.
2. Verify the state you think you are measuring, from inside the page: `document.querySelector("audio").paused`
   plus the app's own classes (`audio-playing`, `is-playing`) plus `document.getAnimations()`.
   Driving the element directly (`audio.play()`) leaves the app's *visual* state behind and measures
   something nobody ever sees — that mistake cost three arms here.
3. A/B **within one state**, or interleave the arms; never compare across runs minutes apart.
4. Read the **median**, and check `rafFramesPerSecond` is ~60 and `document.visibilityState` is
   "visible" — an occluded window is not composited and reads as a miracle.

**The two budgets**, as the user stated them: **idle ≤ 5 %**, **real-time ≤ 30 %**, against a
blank-page floor of 4 %. Both hold after A (5-6 % idle, 22 % playing), with thin headroom on the
playing side.

**The rule that came out of it**, worth putting next to the glass's other rules: *nothing may move
continuously behind a pane.* A `backdrop-filter` samples what is painted behind it, so an animation
behind the glass costs a re-blur of the whole studio every frame, while the same movement in front
of it — the pill's bob, the play disc's swell — costs nothing. If a backdrop must move, step it.

## The plan that remains

What is left, in order of measured value per unit of risk. **Nothing below is implemented.**
(A — the stepped drift — is done; see *What was done about it* above.)

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
