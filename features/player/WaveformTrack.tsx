"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { formatTime } from "@/shared/utilities/time";
import { DEFAULT_WAVEFORM_SETTINGS, type LoopRegion, type WaveformSettings } from "@/shared/parameters";
import { useMediaClock } from "./useMediaClock";
import type { WaveformPeak, WaveformPeaks } from "./peaks";
import "./waveform.css";

/**
 * The waveform, its playhead and the two times under it — the same block in the studio's editor
 * and in the precision editor, so it is one component rather than two that drift.
 *
 * It draws on a canvas because the old row of `<i>` bars could not do any of what makes a
 * waveform useful at this size: a real peak/RMS body, a mirrored envelope, zoom and scroll, a
 * time grid, a loop region. The decorative bar array is still accepted — it is what shows while
 * the real peaks are being decoded, and what a browser without Web Audio keeps showing.
 *
 * Everything that seeks is a pointer: press and drag scrubs, a wheel zooms around the pointer,
 * a double click returns to the whole track, and Alt-dragging paints the A/B loop region when
 * the owner gave the wave a loop handler. The two zoom/window numbers live in the owner's
 * settings, never here — this component reads them and asks for changes.
 */

export type WaveformTrackProps = {
  media: React.RefObject<HTMLMediaElement | null>;
  ariaLabel: string;
  /** Decorative bar heights, 0..100 — drawn until real peaks arrive, or when they never do. */
  waveform?: number[];
  /** The decoded shape from `useWaveformPeaks`; when present it wins over the fallback. */
  peaks?: WaveformPeaks | null;
  /** How the wave is drawn. Defaults to the studio's own settings. */
  options?: WaveformSettings;
  /** The A/B loop region, drawn on the wave; Alt-drag replaces it when a handler is given. */
  loop?: LoopRegion;
  onLoopChange?: (region: LoopRegion) => void;
  /** Zoom, scroll and grid changes from the wheel, the keyboard and the double click. */
  onOptionsChange?: (patch: Partial<WaveformSettings>) => void;
  /** Called with the time under the pointer (null when it leaves) — a readout for the owner. */
  onHoverTime?: (seconds: number | null) => void;
  /** The track's height in pixels; the stylesheet's own height stands when it is absent. */
  height?: number;
};

/** Zoom 1 is the whole file; higher zooms show `1 / zoom` of it, centred on `scroll`. */
function visibleWindow(settings: WaveformSettings) {
  const zoom = Math.max(1, Math.min(32, settings.zoom));
  const span = 1 / zoom;
  const start = zoom > 1 ? Math.min(Math.max(settings.scroll - span / 2, 0), 1 - span) : 0;
  return { start, span };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * A quiet file is drawn up to three times taller so its shape stays legible; a mastered one is
 * drawn at its own level, where the waveform already fills the box.
 */
function displayGainFor(peak: number) {
  if (!(peak > 0) || peak >= 0.25) return 1;
  return Math.min(3, 0.6 / peak);
}

/** One bar's geometry, as fractions of the half-height: the envelope and the blended body. */
function measure(data: WaveformPeak[] | null, fallback: number[] | undefined, from: number, to: number, smooth: number) {
  let min = 0;
  let max = 0;
  let rms = 0;
  if (data && data.length > 0) {
    const first = Math.max(0, Math.floor(from * data.length));
    const last = Math.max(first + 1, Math.min(data.length, Math.ceil(to * data.length)));
    let sum = 0;
    for (let index = first; index < last; index += 1) {
      const bucket = data[index];
      if (bucket.min < min) min = bucket.min;
      if (bucket.max > max) max = bucket.max;
      sum += bucket.rms * bucket.rms;
    }
    rms = Math.sqrt(sum / (last - first));
  } else if (fallback && fallback.length > 0) {
    const at = Math.floor(((from + to) / 2) * fallback.length) % fallback.length;
    const height = Math.max(0, Math.min(100, fallback[at] ?? 0)) / 100;
    min = -height;
    max = height;
    rms = height * 0.72;
  }
  const peak = Math.max(max, -min);
  return { min, max, body: rms + (peak - rms) * (1 - smooth) };
}

const GRID_STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];

/** The tick length that puts roughly eight labels across whatever slice is showing. */
function gridStep(seconds: number) {
  const target = seconds / 8;
  for (const step of GRID_STEPS) if (step >= target) return step;
  return GRID_STEPS[GRID_STEPS.length - 1];
}

function fillBar(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  if (typeof context.roundRect === "function") {
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.fill();
  } else {
    context.fillRect(x, y, width, height);
  }
}

export function WaveformTrack({ media, ariaLabel, waveform, peaks, options, loop, onLoopChange, onOptionsChange, onHoverTime, height }: WaveformTrackProps) {
  const view = options ?? DEFAULT_WAVEFORM_SETTINGS;
  const { time, duration } = useMediaClock(media);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintRef = useRef<() => void>(() => {});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pending, setPending] = useState<number | null>(null);
  const [hover, setHover] = useState<{ at: number; time: number } | null>(null);
  const [drag, setDrag] = useState<"seek" | "loop" | null>(null);
  const [rubber, setRubber] = useState<{ from: number; to: number } | null>(null);
  const shown = pending ?? time;

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const sync = () => {
      const next = { width: wrap.clientWidth, height: wrap.clientHeight };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    };
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  /** A window ratio to a track time — the one conversion every seek and drag goes through. */
  const seekTo = useCallback((ratio: number) => {
    const element = media.current;
    if (!element) return;
    const total = Number.isFinite(element.duration) ? element.duration : 0;
    if (!total) return;
    const { start, span } = visibleWindow(view);
    const value = Math.max(0, Math.min(total, (start + span * ratio) * total));
    element.currentTime = value;
    setPending(value);
    window.setTimeout(() => setPending(null), 120);
  }, [media, view]);

  const draw = useCallback(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const width = size.width || wrap.clientWidth;
    const height = size.height || wrap.clientHeight;
    if (width <= 0 || height <= 0) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(width * ratio));
    const pixelHeight = Math.max(1, Math.round(height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const middle = height / 2;
    const half = Math.max(2, middle - 2);
    const { start, span } = visibleWindow(view);
    const trackToWindow = (seconds: number) => (duration > 0 ? (seconds / duration - start) / span : 0);

    if (view.grid && duration > 0) {
      const step = gridStep(span * duration);
      const from = Math.ceil((start * duration) / step) * step;
      context.strokeStyle = "rgba(154, 159, 176, 0.26)";
      context.fillStyle = "rgba(154, 159, 176, 0.85)";
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.lineWidth = 1;
      for (let tick = from; tick <= (start + span) * duration + 1e-6; tick += step) {
        const x = Math.round(trackToWindow(tick) * width) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
        context.fillText(formatTime(tick), Math.min(width - 32, x + 3), height - 4);
      }
    }

    // The A/B region: the saved one, or the one being painted right now.
    const region = drag === "loop" && rubber
      ? { from: Math.min(rubber.from, rubber.to), to: Math.max(rubber.from, rubber.to), live: true }
      : loop && loop.end > loop.start && duration > 0
        ? { from: trackToWindow(loop.start), to: trackToWindow(loop.end), live: false }
        : null;
    if (region) {
      const left = region.from * width;
      const right = region.to * width;
      context.fillStyle = "rgba(242, 108, 114, 0.16)";
      context.fillRect(left, 0, Math.max(1, right - left), height);
      context.strokeStyle = "rgba(242, 108, 114, 0.9)";
      context.lineWidth = 1;
      if (region.live) context.setLineDash([4, 3]);
      for (const edge of [left, right]) {
        const x = Math.round(edge) + 0.5;
        context.beginPath();
        context.moveTo(x, 0);
        context.lineTo(x, height);
        context.stroke();
      }
      context.setLineDash([]);
    }

    const count = Math.max(8, Math.min(Math.round(view.resolution), Math.max(8, Math.floor(width / 2))));
    const gap = Math.max(0, Math.min(80, view.gap)) / 100;
    const slot = width / count;
    const barWidth = Math.max(1, slot * (1 - gap));
    const radius = Math.min(barWidth / 2, 3);
    const smooth = clamp01(view.smoothing / 100);
    const gain = Math.max(0.5, view.amplitude / 100) * (peaks ? displayGainFor(peaks.peak) : 1);
    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#ffb0b3");
    gradient.addColorStop(0.5, "#f2707a");
    gradient.addColorStop(1, "#c93a40");
    context.fillStyle = gradient;
    context.globalAlpha = 0.82;
    for (let index = 0; index < count; index += 1) {
      const from = start + span * (index / count);
      const to = start + span * ((index + 1) / count);
      const shape = measure(peaks?.peaks ?? null, waveform, from, to, smooth);
      const x = index * slot + (slot - barWidth) / 2;
      if (view.mirror) {
        const top = Math.max(0, middle - shape.max * gain * half);
        const bottom = Math.min(height, middle - shape.min * gain * half);
        fillBar(context, x, top, barWidth, Math.max(1, bottom - top), radius);
      } else {
        const amplitude = clamp01(shape.body * gain) * half;
        fillBar(context, x, middle - amplitude, barWidth, Math.max(1.5, amplitude * 2), radius);
      }
    }
    context.globalAlpha = 1;

    if (view.playhead && duration > 0) {
      const x = trackToWindow(shown) * width;
      if (x >= -1 && x <= width + 1) {
        context.save();
        context.strokeStyle = "#f26c72";
        context.lineWidth = 2;
        context.shadowColor = "rgba(242, 108, 114, 0.75)";
        context.shadowBlur = 8;
        context.beginPath();
        context.moveTo(Math.round(x) + 0.5, 0);
        context.lineTo(Math.round(x) + 0.5, height);
        context.stroke();
        context.restore();
      }
    }

    if (hover) {
      const x = Math.round(hover.at * width) + 0.5;
      context.strokeStyle = "rgba(255, 255, 255, 0.35)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }, [duration, drag, hover, loop, peaks, rubber, shown, size.height, size.width, view, waveform]);

  // The canvas paints from a ref so the play walk below always calls the newest closure.
  useEffect(() => {
    paintRef.current = draw;
    draw();
  }, [draw]);

  // While the element plays, the head is painted per frame rather than per `timeupdate`.
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    let frame: number | null = null;
    const tick = () => {
      frame = null;
      paintRef.current();
      if (!element.paused && !element.ended) frame = window.requestAnimationFrame(tick);
    };
    const start = () => {
      if (frame === null && !element.paused && !element.ended) frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };
    element.addEventListener("play", start);
    element.addEventListener("pause", stop);
    element.addEventListener("ended", stop);
    if (!element.paused) start();
    return () => {
      stop();
      element.removeEventListener("play", start);
      element.removeEventListener("pause", stop);
      element.removeEventListener("ended", stop);
    };
  }, [media]);

  // The wheel is bound natively because zoom has to stop the page from scrolling under it.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !onOptionsChange) return;
    const onWheel = (event: WheelEvent) => {
      const zoom = Math.max(1, Math.min(32, view.zoom));
      const span = 1 / zoom;
      if (event.shiftKey) {
        if (zoom <= 1) return;
        event.preventDefault();
        const next = Math.max(span / 2, Math.min(1 - span / 2, view.scroll + (event.deltaY || event.deltaX) * 0.0015));
        onOptionsChange({ scroll: next });
        return;
      }
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      const anchor = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      const nextZoom = Math.max(1, Math.min(32, zoom * (event.deltaY < 0 ? 1.25 : 0.8)));
      if (nextZoom === zoom) return;
      const here = visibleWindow(view);
      const point = here.start + here.span * anchor;
      const nextSpan = 1 / nextZoom;
      const scroll = nextZoom === 1 ? 0.5 : Math.max(nextSpan / 2, Math.min(1 - nextSpan / 2, point + nextSpan * (0.5 - anchor)));
      onOptionsChange({ zoom: nextZoom, scroll });
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [onOptionsChange, view]);

  function ratioOf(clientX: number) {
    const wrap = wrapRef.current;
    if (!wrap) return 0;
    const rect = wrap.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const ratio = ratioOf(event.clientX);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.altKey && onLoopChange && duration > 0) {
      setDrag("loop");
      setRubber({ from: ratio, to: ratio });
      return;
    }
    setDrag("seek");
    seekTo(ratio);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const ratio = ratioOf(event.clientX);
    const { start, span } = visibleWindow(view);
    const element = media.current;
    const total = element && Number.isFinite(element.duration) ? element.duration : 0;
    const at = (start + span * ratio) * total;
    setHover({ at: ratio, time: at });
    onHoverTime?.(total ? at : null);
    if (drag === "seek") seekTo(ratio);
    else if (drag === "loop") setRubber((current) => (current ? { ...current, to: ratio } : current));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag === "loop" && rubber && onLoopChange) {
      const element = media.current;
      const total = element && Number.isFinite(element.duration) ? element.duration : 0;
      const { start, span } = visibleWindow(view);
      const from = Math.min(rubber.from, rubber.to);
      const to = Math.max(rubber.from, rubber.to);
      const loopStart = (start + span * from) * total;
      const loopEnd = (start + span * to) * total;
      // A stray Alt-click is not a request for a zero-length loop; it just leaves the region be.
      if (loopEnd - loopStart >= 0.2) onLoopChange({ on: true, start: loopStart, end: loopEnd });
    }
    setDrag(null);
    setRubber(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const element = media.current;
    if (!element) return;
    const total = Number.isFinite(element.duration) ? element.duration : 0;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = (event.shiftKey ? 1 : 5) * (event.key === "ArrowRight" ? 1 : -1);
      const next = Math.max(0, Math.min(total, element.currentTime + step));
      element.currentTime = next;
      setPending(next);
      window.setTimeout(() => setPending(null), 120);
      return;
    }
    if (!onOptionsChange) return;
    if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_") {
      event.preventDefault();
      const here = visibleWindow(view);
      const nextZoom = Math.max(1, Math.min(32, view.zoom * (event.key === "-" || event.key === "_" ? 0.8 : 1.25)));
      if (nextZoom === view.zoom) return;
      const point = here.start + here.span / 2;
      const nextSpan = 1 / nextZoom;
      const scroll = nextZoom === 1 ? 0.5 : Math.max(nextSpan / 2, Math.min(1 - nextSpan / 2, point));
      onOptionsChange({ zoom: nextZoom, scroll });
    } else if (event.key === "0") {
      event.preventDefault();
      onOptionsChange({ zoom: 1, scroll: 0.5 });
    }
  }

  return (
    <>
      <div
        ref={wrapRef}
        className="wave-track interactive-wave"
        style={height ? { height } : undefined}
        role="slider"
        aria-label={ariaLabel}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={shown}
        aria-valuetext={formatTime(shown)}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => { if (!drag) { setHover(null); onHoverTime?.(null); } }}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onOptionsChange?.({ zoom: 1, scroll: 0.5 })}
        title={onLoopChange
          ? "Click to seek · drag to scrub · wheel to zoom · double-click to reset · Alt-drag for an A/B loop"
          : "Click to seek · drag to scrub · wheel to zoom · double-click to reset"}
      >
        <canvas ref={canvasRef} className="wave-canvas" aria-hidden="true" />
        {hover && <span className="wave-readout" style={{ left: `${hover.at * 100}%` }}>{formatTime(hover.time)}</span>}
      </div>
      <div className="wave-times"><span>{formatTime(shown)}</span><span>{formatTime(duration)}</span></div>
    </>
  );
}
