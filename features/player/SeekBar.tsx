"use client";

import { useState, type CSSProperties, type RefObject } from "react";
import { formatTime } from "@/shared/utilities/time";
import { useMediaClock } from "./useMediaClock";

/**
 * The seek row: elapsed time, the hairline that fills, and the length — or what is left of it.
 *
 * It shows up three times (the bar, the now-playing view, and — with a different right label —
 * the video dock's own copy) and each one used to be wired by hand in the page. Here the row owns
 * its subscription to the media element, so dragging it is the only thing that re-renders.
 *
 * The drag writes the element's `currentTime` and holds the value it was asked for until the seek
 * lands; without that the knob would snap back to the old position for a frame, which is exactly
 * the flicker a controlled input is supposed to avoid.
 */
export function SeekBar({ media, remaining, disabled, ariaLabel, onSeek }: {
  media: RefObject<HTMLMediaElement | null>;
  /** Show what is left rather than the total on the right. */
  remaining?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  /** A user seek — the editor uses it to stand down an auditioning interval. */
  onSeek?: () => void;
}) {
  const { time, duration } = useMediaClock(media);
  const [pending, setPending] = useState<number | null>(null);
  const shown = pending ?? time;
  const percent = duration ? (shown / duration) * 100 : 0;

  function seekTo(value: number) {
    const element = media.current;
    if (!element) return;
    const total = Number.isFinite(element.duration) ? element.duration : 0;
    if (!total) return;
    element.currentTime = value;
    onSeek?.();
    setPending(value);
    // The next tick is the element's own reading; until then the pending value is what shows.
    window.setTimeout(() => setPending(null), 120);
  }

  return (
    <div className="progress-wrap">
      <span>{formatTime(disabled ? 0 : time)}</span>
      <input type="range" min={0} max={duration || 1} step="0.1" value={disabled ? 0 : shown}
        style={{ "--seek": `${disabled ? 0 : percent}%` } as CSSProperties}
        onChange={(event) => seekTo(Number(event.target.value))} disabled={disabled} aria-label={ariaLabel} />
      <span>{remaining ? `−${formatTime(disabled ? 0 : Math.max(0, duration - shown))}` : formatTime(duration)}</span>
    </div>
  );
}
