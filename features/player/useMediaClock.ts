"use client";

import { useEffect, useState, type RefObject } from "react";

/**
 * The position and length of whatever a media element is holding, as a subscription rather than
 * as the page's state.
 *
 * This is the whole point of the player feature: `timeupdate` fires about four times a second
 * while a song plays, and when that lived in the page's state every one of those ticks re-rendered
 * the entire studio — the sidebar, the library, the sheets, the bar — to move one number. Here the
 * clock belongs to the thing that shows it, so a tick re-renders the time labels and nothing else.
 *
 * It is deliberately a listener and not a `requestAnimationFrame` loop: `timeupdate` is the
 * cadence the studio has always shown, and keeping it means the numbers behave exactly as before.
 * An element that is not there yet (no track loaded, a video asset selected) simply reports zeros.
 */
export function useMediaClock(media: RefObject<HTMLMediaElement | null>) {
  const [clock, setClock] = useState({ time: 0, duration: 0 });

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const syncTime = () => {
      const next = element.currentTime;
      setClock((current) => (current.time === next ? current : { ...current, time: next }));
    };
    const syncDuration = () => {
      const next = Number.isFinite(element.duration) ? element.duration : 0;
      setClock((current) => (current.duration === next ? current : { ...current, duration: next }));
    };
    // `seeking`/`seeked` and `emptied` are what keep the reading honest when a track is switched
    // or the element is reset: the position jumps or vanishes with no timeupdate to announce it.
    const events: (keyof HTMLMediaElementEventMap)[] = ["timeupdate", "seeking", "seeked", "emptied", "play", "pause", "ended"];
    for (const type of events) element.addEventListener(type, syncTime);
    element.addEventListener("loadedmetadata", syncDuration);
    element.addEventListener("durationchange", syncDuration);
    syncTime();
    syncDuration();
    return () => {
      for (const type of events) element.removeEventListener(type, syncTime);
      element.removeEventListener("loadedmetadata", syncDuration);
      element.removeEventListener("durationchange", syncDuration);
    };
  }, [media]);

  return clock;
}
