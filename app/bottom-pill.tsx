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
 * The small screen's navigation: the sidebar's items as a floating glass pill, with a bubble that
 * can be pressed and dragged along it. A press that stays put is a tap and opens that item; a
 * press that moves raises the bubble, carries the selection with it, and settles on whatever is
 * nearest when the finger comes up — the same gesture as a system tab bar, and the only way to
 * change pages on a phone without reaching for a menu.
 */
export default function BottomPill({ items, current, onSelect, onRaiseChange, onBubbleMove }: Props) {
  const pillRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const drag = useRef<{
    pointer: number;
    startX: number;
    index: number;
    raised: boolean;
    /** Where the finger sits inside the bubble, and how wide it is: both fixed when it is picked
        up, so the bubble keeps its place under the finger however the nearest item changes. */
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
  const [bubble, setBubble] = useState({ index: 0, x: 0, width: 0, raised: false, dragging: false });

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

  function raise(index: number) {
    const state = drag.current;
    // Capture only once the gesture is a drag: a captured pointer sends the click to the
    // capturing element, and a plain tap has to keep reaching the button it started on.
    if (state) {
      state.raised = true;
      const pill = pillRef.current;
      const box = state.centres[index];
      if (pill && box) {
        state.grab = state.startX - pill.getBoundingClientRect().left - box.left;
        state.width = box.width;
      }
      capture(state.pointer, true);
    }
    setBubble((current) => ({ ...current, index, raised: true, dragging: true }));
    onRaiseChange?.(true);
    // The bubble has just changed both its size and its material; a rim drawn from the old ones
    // would not match the pane it belongs to.
    onBubbleMove?.();
  }

  /**
   * Puts the capsule on the current item, wherever the pill's layout has put it now. `instant` is
   * for placement rather than movement — the first paint, and every time the pill's own box
   * changes — where the capsule must be found already sitting on its item instead of sliding and
   * stretching across to it from wherever the old layout had left it. The transition is turned off
   * for the write and folded in with a forced reflow, so the change never becomes an animation.
   */
  function place(instant = false) {
    if (drag.current) return;
    const box = measure()[activeRef.current];
    if (!box) return;
    const element = bubbleRef.current;
    if (instant && element) {
      element.style.transition = "none";
      element.style.setProperty("--bubble-x", `${box.left}px`);
      element.style.setProperty("--bubble-w", `${box.width}px`);
      void element.offsetWidth;
      element.style.transition = "";
    }
    setBubble({ index: activeRef.current, x: box.left, width: box.width, raised: false, dragging: false });
    // Settling back also restores the resting material, so the rim is told about that too.
    moveRef.current?.();
  }

  // The bubble rests on the current item whenever no gesture is in flight: the pointer over the
  // pill changes nothing — the glass is raised by a press, never by a hover. Changing item *is*
  // movement, so it travels; the first placement — the pill appearing at all — does not, or a
  // window crossing into the small screen would show the capsule stretching out of nothing.
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

  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  function end(pressed: boolean) {
    window.clearTimeout(holdTimer.current);
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    capture(state.pointer, false);
    if (!state.raised) return;
    // Whatever the pointer was over when it came up must not also receive the click that follows:
    // the drag has already chosen an item.
    skipClick.current = performance.now();
    onRaiseChange?.(false);
    if (pressed) onSelect(items[state.index].id);
    const box = measure()[state.index];
    if (box) setBubble((current) => ({ ...current, index: state.index, x: box.left, width: box.width, raised: false, dragging: false }));
    onBubbleMove?.();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>, index: number) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    drag.current = { pointer: event.pointerId, startX: event.clientX, index, raised: false, grab: 0, width: 0, centres: measure() };
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => raise(index), HOLD_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const state = drag.current;
    if (!state || event.pointerId !== state.pointer) return;
    const dx = event.clientX - state.startX;
    if (!state.raised) {
      if (Math.abs(dx) < DRAG_SLOP) return;
      window.clearTimeout(holdTimer.current);
      raise(state.index);
    }
    const pill = pillRef.current;
    if (!pill) return;
    const finger = event.clientX - pill.getBoundingClientRect().left;
    const x = Math.min(Math.max(0, finger - state.grab), pill.clientWidth - state.width);
    let nearest = state.index;
    let best = Infinity;
    state.centres.forEach((box, index) => {
      const distance = Math.abs(box.centre - finger);
      if (distance < best) { best = distance; nearest = index; }
    });
    state.index = nearest;
    setBubble((current) => ({ ...current, index: nearest, x, raised: true, dragging: true }));
    onBubbleMove?.();
  }

  return (
    <nav
      ref={pillRef}
      className="bottom-pill"
      data-glass-edge="1"
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
        style={{ "--bubble-x": `${bubble.x}px`, "--bubble-w": `${bubble.width}px` } as CSSProperties}
      />
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => { itemRefs.current[index] = element; }}
          type="button"
          role="tab"
          aria-selected={item.id === current}
          className={`pill-item ${item.id === current ? "is-current" : ""}`}
          onPointerDown={(event) => onPointerDown(event, index)}
          onClick={() => { if (performance.now() - skipClick.current < 300) return; onSelect(item.id); }}
        >
          <span className="pill-icon">{item.icon}</span>
          <span className="pill-label">{item.label}</span>
          {item.badge ? <span className="pill-count">{item.badge}</span> : null}
        </button>
      ))}
    </nav>
  );
}
