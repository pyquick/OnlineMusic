/**
 * The two ambient orbs' drift, stepped rather than animated.
 *
 * They are the only thing in the studio that moves while nothing is happening, and moving is what
 * costs: `backdrop-filter` samples what is painted behind it, so every frame those 440px and 480px
 * clouds travel, **every pane in the studio re-blurs**. Measured on the target machine (AMD RX 590,
 * 1440×900 @2x): the studio idles at **99 % GPU** with the CSS animations running, **5 %** with the
 * orbs held still, and **5 %** again with the very same drift applied **once a second** instead of
 * sixty times. The cost is per change, not per distance — so a step small enough to be invisible on
 * a cloud this soft costs nothing at all, and the colour keeps its slow life.
 *
 * A CSS animation could not be throttled this way (a keyframe animating `translate` runs at the
 * frame rate, and an animation also out-ranks the inline styles this writes), which is why the
 * keyframes are gone from the stylesheet and the drift lives here.
 *
 * Under `prefers-reduced-motion` the orbs are placed once and left alone.
 */

/** How often a step is taken. One a second: the measured sweet spot. */
const STEP_MS = 1000;
/** Seconds for one there-and-back, matching the animation this replaces. */
const PERIOD_A = 22;
const PERIOD_B = 27;
/** How far each orb wanders, and how it scales on the way, from the old keyframes. */
const TRAVEL_A = { x: 70, y: -60, from: 1, to: 1.12 };
const TRAVEL_B = { x: -80, y: -50, from: 1.06, to: 1 };

/** `alternate` + `ease-in-out`, as a function of the phase: 0 at the ends, 1 in the middle. */
const pingPong = (phase: number) => 0.5 - 0.5 * Math.cos(2 * Math.PI * phase);

/** Starts the drift and returns the stop function, in the shape of the other DOM engines. */
export function startAmbientDrift(): () => void {
  const orbs = Array.from(document.querySelectorAll<HTMLElement>(".ambient-orb"));
  if (orbs.length === 0) return () => {};

  const place = (elapsed: number) => {
    const pairs: [HTMLElement, typeof TRAVEL_A, number][] = [
      [orbs[0], TRAVEL_A, PERIOD_A],
      [orbs[1] ?? orbs[0], TRAVEL_B, PERIOD_B],
    ];
    for (const [orb, travel, period] of pairs) {
      const t = pingPong((elapsed / period) % 1);
      orb.style.translate = `${(travel.x * t).toFixed(2)}px ${(travel.y * t).toFixed(2)}px`;
      orb.style.scale = (travel.from + (travel.to - travel.from) * t).toFixed(4);
    }
  };

  place(0);
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};

  let elapsed = 0;
  const timer = window.setInterval(() => {
    elapsed = (elapsed + STEP_MS / 1000) % (PERIOD_A * PERIOD_B);
    place(elapsed);
  }, STEP_MS);

  return () => window.clearInterval(timer);
}
