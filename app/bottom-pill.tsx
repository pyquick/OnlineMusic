"use client";

import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState, type ReactNode } from "react";

export type PillItem = { id: string; label: string; icon: ReactNode; badge?: string | number };

type Props = {
  items: PillItem[];
  current: string;
  onSelect: (id: string) => void;
  /** True from the moment the bubble is raised until it settles: the player bar shrinks aside. */
  onRaiseChange?: (raised: boolean) => void;
  /** Fires as the bubble moves, so a WebGL rim can redraw at its new box without re-rasterising. */
  onBubbleMove?: () => void;
};

/** How long a press has to last before the glass bubble comes up under the finger. */
const HOLD_MS = 180;
/** How far a press may drift before it is read as a drag rather than a slightly unsteady tap. */
const DRAG_SLOP = 6;
/**
 * How far outside the resting capsule a press may land and still be read as taking hold of it.
 * Deliberately not the drift slop: that one is where a tap has moved far enough to become a drag,
 * this one is which presses are allowed to touch the glass at all.
 */
const GRAB_PAD = 12;
/** The spring the capsule is carried on — soft enough that being moved reads as weight, damped so
    it comes to rest in about half a second without visibly nodding past the mark. */
const SPRING_STIFFNESS = 150;
const SPRING_DAMPING = 22;
/** Below this much travel and this much speed the spring is spent and the capsule simply arrives. */
const SPRING_REST = 0.15;
/** How far the capsule must move before the WebGL rim is told about its new box. */
const MOVE_EPSILON = 0.5;

/**
 * The small screen's navigation: the sidebar's items as a floating glass pill, with a capsule of
 * glass resting on the current one. Only a press that lands on the capsule — or on the little air
 * around it — takes hold of it: it comes up where it already is and follows the finger on a
 * spring. Let go, it settles onto the nearest item and opens it. A press anywhere else on the pill
 * is none of the capsule's business — it stays a plain tap, and a tap opens the item it landed on.
 */
export default function BottomPill({ items, current, onSelect, onRaiseChange, onBubbleMove }: Props) {
  const pillRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{
    pointer: number;
    startX: number;
    index: number;
    raised: boolean;
    /** Where the finger sits inside the capsule, and how wide it is: both fixed when the press
        lands, so the capsule keeps its place under the finger however the nearest item changes. */
    grab: number;
    width: number;
    centres: { left: number; width: number; centre: number }[];
  } | null>(null);
  const holdTimer = useRef(0);
  /** When the last drag ended, so the click it leaves behind can be recognised and dropped. */
  const skipClick = useRef(0);
  const active = Math.max(0, items.findIndex((item) => item.id === current));
  /** The current item for the listeners below: they outlive the render that made them. */
  const activeRef = useRef(active);
  activeRef.current = active;
  /** The move callback too: it is written inline by the page, so a new one arrives every render. */
  const moveRef = useRef(onBubbleMove);
  moveRef.current = onBubbleMove;
  const bubbleRef = useRef<HTMLSpanElement>(null);
  /**
   * The capsule's own motion. `x` is where it is drawn and `target` where the gesture says it
   * should be; the space between them is crossed by a spring, so no press can ever teleport the
   * glass — it is taken hold of where it already is and carried with weight. The frame loop reads
   * only refs and never state, so a render happening mid-flight cannot make it stale. `notified`
   * remembers the last position the WebGL rim was told about.
   */
  const spring = useRef({ x: 0, target: 0, v: 0, raf: 0, last: 0, notified: 0 });
  /** A phone does not change its mind mid-session about wanting motion. */
  const reduceMotion = useRef(false);
  const [bubble, setBubble] = useState({ index: 0, width: 0, raised: false, dragging: false });

  /** Where each item sits inside the pill, read once per gesture so a move never forces layout. */
  function measure() {
    const pill = pillRef.current;
    if (!pill) return [];
    const pillBox = pill.getBoundingClientRect();
    return items.map((_, index) => {
      const element = itemRefs.current[index];
      const box = element?.getBoundingClientRect();
      const left = (box?.left ?? 0) - pillBox.left;
      const width = box?.width ?? 0;
      return { left, width, centre: left + width / 2 };
    });
  }

  /** Capture is an optimisation, never a requirement: a pointer that is already gone must not
      take the whole gesture down with it. */
  function capture(pointer: number, on: boolean) {
    const pill = pillRef.current;
    if (!pill) return;
    try {
      if (on) pill.setPointerCapture(pointer);
      else if (pill.hasPointerCapture(pointer)) pill.releasePointerCapture(pointer);
    } catch { /* the pointer is no longer active */ }
  }

  /** Draws the capsule wherever the spring currently has it, and tells the rim when that is a
      place it has not been shown yet. */
  function paint() {
    const element = bubbleRef.current;
    if (!element) return;
    const state = spring.current;
    element.style.setProperty("--bubble-x", `${state.x}px`);
    if (Math.abs(state.x - state.notified) >= MOVE_EPSILON) {
      state.notified = state.x;
      moveRef.current?.();
    }
  }

  /** One frame of the spring: pulled toward the target, damped, and put down when it is spent. */
  function step(now: number) {
    const state = spring.current;
    state.raf = 0;
    const dt = Math.min(1 / 30, (now - state.last) / 1000 || 1 / 60);
    state.last = now;
    state.v += (SPRING_STIFFNESS * (state.target - state.x) - SPRING_DAMPING * state.v) * dt;
    state.x += state.v * dt;
    if (Math.abs(state.target - state.x) < SPRING_REST && Math.abs(state.v) < SPRING_REST) {
      state.x = state.target;
      state.v = 0;
      paint();
      return;
    }
    paint();
    state.raf = window.requestAnimationFrame(step);
  }

  /** Sends the capsule after wherever it has just been told the target is. A running loop picks
      the new target up on its next frame; a spent one has to be started again. */
  function glide() {
    const state = spring.current;
    if (reduceMotion.current) {
      settleAt(state.target);
      return;
    }
    if (state.raf) return;
    state.last = performance.now();
    state.raf = window.requestAnimationFrame(step);
  }

  /** Stops the spring and puts the capsule exactly somewhere. This is placement, not movement —
      the first paint, a resize — and it must not read as the glass having travelled. */
  function settleAt(x: number) {
    const state = spring.current;
    if (state.raf) window.cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.x = state.target = x;
    state.v = 0;
    paint();
  }

  /**
   * Picks the capsule up — where it already is. The press that started the gesture chose its
   * grip, so nothing here moves the glass: the spring is the only thing that ever does. Capture
   * only starts once the gesture is a drag: a captured pointer sends the click to the capturing
   * element, and a plain tap has to keep reaching the button it started on.
   */
  function raise() {
    const state = drag.current;
    if (!state) return;
    state.raised = true;
    capture(state.pointer, true);
    setBubble((current) => ({ ...current, index: state.index, raised: true, dragging: true }));
    onRaiseChange?.(true);
    // The bubble has just changed both its size and its material; a rim drawn from the old ones
    // would not match the pane it belongs to.
    onBubbleMove?.();
  }

  /**
   * Puts the capsule on the current item, wherever the pill's layout has put it now. `instant` is
   * for placement rather than movement — the first paint, and every time the pill's own box
   * changes — where the capsule must be found already sitting on its item instead of travelling
   * across to it from wherever the old layout had left it: the spring is stopped and the position
   * written straight. Width and the rest of the geometry still cross on CSS transitions, so that
   * write is folded in with a forced reflow and never becomes an animation either.
   */
  function place(instant = false) {
    if (drag.current) return;
    const box = measure()[activeRef.current];
    if (!box) return;
    const element = bubbleRef.current;
    if (instant && element) {
      element.style.transition = "none";
      element.style.setProperty("--bubble-w", `${box.width}px`);
      void element.offsetWidth;
      element.style.transition = "";
      settleAt(box.left);
    } else {
      spring.current.target = box.left;
      glide();
    }
    setBubble({ index: activeRef.current, width: box.width, raised: false, dragging: false });
    // Settling back also restores the resting material, so the rim is told about that too.
    moveRef.current?.();
  }

  // The capsule rests on the current item whenever no gesture is in flight: a pointer merely over
  // the pill changes nothing — the glass is raised by a press, never by a hover. Changing item
  // *is* movement, so it travels on the spring; the first placement — the pill appearing at all —
  // does not, or a window crossing into the small screen would show the capsule sliding in out of
  // nowhere. The motion preference has to be known before that first placement.
  useEffect(() => {
    reduceMotion.current = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);
  const placed = useRef(false);
  useEffect(() => {
    place(!placed.current);
    placed.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, items.length]);

  // The pill's own box is the layout: when it changes — the window crossing the 680px breakpoint,
  // a rotation, the bar above growing — every item moves with it. The capsule is placed again from
  // the new boxes, and instantly, so the change of layout never reads as the capsule leaving its
  // item.
  useEffect(() => {
    const pill = pillRef.current;
    if (!pill) return;
    const observer = new ResizeObserver(() => place(true));
    observer.observe(pill);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => () => {
    window.clearTimeout(holdTimer.current);
    window.cancelAnimationFrame(spring.current.raf);
  }, []);

  function end(pressed: boolean) {
    window.clearTimeout(holdTimer.current);
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    capture(state.pointer, false);
    releaseFocus();
    if (!state.raised) return;
    // Whatever the pointer was over when it came up must not also receive the click that follows:
    // the drag has already chosen an item.
    skipClick.current = performance.now();
    onRaiseChange?.(false);
    if (pressed) onSelect(items[state.index].id);
    const box = measure()[state.index];
    if (box) {
      // It is put down where it stands and left to the spring to find its item — a settle, not a
      // jump.
      spring.current.target = box.left;
      glide();
      setBubble((current) => ({ ...current, index: state.index, width: box.width, raised: false, dragging: false }));
    }
    onBubbleMove?.();
  }

  /**
   * A tile that has just been pressed has no reason to keep focus: the browser focuses a button on
   * pointerdown, and hands it the focus ring a moment later — the blue box the user saw around
   * Projects after a tap or a drag. The ring belongs to the keyboard, and a keyboard never comes
   * through a pointer handler, so clearing it here cannot take it away from anyone who needs it.
   * (Same move the space-bar transport makes on the play button.)
   */
  function releaseFocus() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && pillRef.current?.contains(active)) active.blur();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // Whatever the last gesture left focused goes first, before this press hands the tile focus.
    releaseFocus();
    // The glass can only be taken hold of where it already is. A press beyond the capsule and its
    // little air is left entirely alone — no hold, no drag, no capture — so the tap it belongs to
    // still reaches the item it started on, and dragging from there lifts nothing (the same
    // "nothing happens" the user asked for, since the pill suppresses scrolling too). The zone is
    // measured from the capsule's painted box, live, so a capsule still travelling on a spring is
    // met where it is drawn rather than where it is headed; before the first placement its box is
    // empty, and there is no glass to take hold of yet anyway.
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && (event.clientX < rect.left - GRAB_PAD || event.clientX > rect.right + GRAB_PAD)) return;
    const pill = pillRef.current;
    const centres = measure();
    const width = centres[activeRef.current]?.width ?? 0;
    const finger = pill ? event.clientX - pill.getBoundingClientRect().left : 0;
    drag.current = {
      pointer: event.pointerId,
      startX: event.clientX,
      // The gesture starts on the item the capsule is resting on, not the one under the finger:
      // presses near the capsule's edge may land on a neighbour, and the glass is not theirs.
      index: activeRef.current,
      raised: false,
      grab: Math.min(Math.max(0, finger - spring.current.x), width),
      width,
      centres,
    };
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(raise, HOLD_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointer) return;
    const dx = event.clientX - state.startX;
    if (!state.raised) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      window.clearTimeout(holdTimer.current);
      raise();
    }
    const pill = pillRef.current;
    if (!pill) return;
    const finger = event.clientX - pill.getBoundingClientRect().left;
    // Where the capsule wants to be: under the finger at the grip it was taken by, held inside the
    // pill. The spring owns the travel from wherever it currently is.
    spring.current.target = Math.min(Math.max(0, finger - state.grab), pill.clientWidth - state.width);
    glide();
    let nearest = state.index;
    let best = Infinity;
    state.centres.forEach((box, index) => {
      const distance = Math.abs(box.centre - finger);
      if (distance < best) { best = distance; nearest = index; }
    });
    if (nearest !== state.index) {
      state.index = nearest;
      setBubble((current) => ({ ...current, index: nearest, raised: true, dragging: true }));
    }
  }

  return (
    <nav
      ref={pillRef}
      className="bottom-pill"
      data-glass-edge="1"
      data-glass-scene="fixed-shell"
      role="tablist"
      aria-label="Primary"
      onPointerMove={onPointerMove}
      onPointerUp={(event) => { if (drag.current?.pointer === event.pointerId) end(true); }}
      onPointerCancel={(event) => { if (drag.current?.pointer === event.pointerId) end(false); }}
    >
      <span
        ref={bubbleRef}
        className={`pill-bubble ${bubble.raised ? "is-raised" : ""} ${bubble.dragging ? "is-dragging" : ""}`}
        aria-hidden="true"
        // The bend is asked for at the tile's own ceiling, and the boost is what gets it there: a
        // capsule 60px tall bends across 30px — half its short side is as deep as any rim may
        // reach — and the pull rides at the boosted cap that goes with it. Anything less and a
        // tile this small would only ever show a hint of what the tall panes show.
        data-glass-edge="12"
        data-glass-scene="nested-host"
        // --bubble-x is written by the spring, frame by frame; React only owns the width.
        style={{ "--bubble-w": `${bubble.width}px` } as CSSProperties}
      />
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => { itemRefs.current[index] = element; }}
          type="button"
          role="tab"
          aria-selected={item.id === current}
          className={`pill-item ${item.id === current ? "is-current" : ""}`}
          onPointerDown={onPointerDown}
          // The ring is cleared here too: touch browsers hand a tile focus at tap recognition —
          // pointerup/click time, after both places that could have cleared it — and this handler
          // runs in the same task as that focus, so no ring is ever painted. A keyboard never
          // comes through a click, so the ring it needs is still there.
          onClick={() => { releaseFocus(); if (performance.now() - skipClick.current < 300) return; onSelect(item.id); }}
        >
          <span className="pill-icon">{item.icon}</span>
          <span className="pill-label">{item.label}</span>
          {item.badge ? <span className="pill-count">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
