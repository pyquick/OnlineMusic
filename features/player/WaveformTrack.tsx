"use client";

import { useState, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { formatTime } from "@/shared/utilities/time";
import { useMediaClock } from "./useMediaClock";

/**
 * The waveform, its playhead, and the two times under it — the same block in the studio's editor
 * and in the precision editor, so it is one component rather than two that drift.
 *
 * Clicking anywhere on the track seeks: the ratio is measured here, against this element's own
 * box, because the box is the only thing that knows where "here" is. The playhead subscribes to
 * the clock on its own, which keeps a playing song from re-rendering the editor around it.
 */
export function WaveformTrack({ media, waveform, ariaLabel }: {
  media: RefObject<HTMLMediaElement | null>;
  waveform: number[];
  ariaLabel: string;
}) {
  const { time, duration } = useMediaClock(media);
  const [pending, setPending] = useState<number | null>(null);
  const shown = pending ?? time;
  const percent = duration ? (shown / duration) * 100 : 0;

  function seekFromPointer(event: ReactMouseEvent<HTMLElement>) {
    const element = media.current;
    if (!element) return;
    const total = Number.isFinite(element.duration) ? element.duration : 0;
    if (!total) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    element.currentTime = total * ratio;
    setPending(total * ratio);
    window.setTimeout(() => setPending(null), 120);
  }

  return (
    <>
      <div className="wave-track interactive-wave" onClick={seekFromPointer} role="slider" aria-label={ariaLabel} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={shown} tabIndex={0}>
        <div className="wave-bars">{waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div>
        <div className="playhead" style={{ left: `${percent}%` }} />
      </div>
      <div className="wave-times"><span>{formatTime(shown)}</span><span>{formatTime(duration)}</span></div>
    </>
  );
}
