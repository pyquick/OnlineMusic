"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { loadPeaks } from "./peaks";

/**
 * The waveform ruler: the real peak envelope of the song, a playhead that follows the media
 * element, and a scrub surface. It is a canvas rather than elements because a few thousand bars
 * would be a few thousand layout boxes; the playhead is a plain div moved by one rAF loop while
 * the song plays, so dragging and playing never re-render React.
 */
export type WaveformBandProps = {
  url: string;
  media: RefObject<HTMLMediaElement | null>;
  /** Seconds, the audio's own duration once known; the fallback scale before metadata lands. */
  fallbackDuration: number;
};

export default function WaveformBand({ url, media, fallbackDuration }: WaveformBandProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const peaksRef = useRef<Float32Array | null>(null);
  const scrubbing = useRef(false);
  const frame = useRef(0);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [duration, setDuration] = useState(fallbackDuration);

  // The audio's own duration, once its metadata is known, is the ruler everything is drawn on.
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const sync = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) setDuration(element.duration);
    };
    sync();
    element.addEventListener("loadedmetadata", sync);
    element.addEventListener("durationchange", sync);
    return () => {
      element.removeEventListener("loadedmetadata", sync);
      element.removeEventListener("durationchange", sync);
    };
  }, [media, url]);

  useEffect(() => {
    let live = true;
    peaksRef.current = null;
    setState("loading");
    void loadPeaks(url, fallbackDuration).then((peaks) => {
      if (!live) return;
      peaksRef.current = peaks;
      setState(peaks ? "ready" : "unavailable");
      draw();
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => draw();
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  /** The playhead follows the element while it plays, and stops the moment it does. */
  useEffect(() => {
    const found = media.current;
    if (!found) return;
    const audio = found;
    const place = () => {
      const head = playheadRef.current;
      const span = duration > 0 ? duration : 1;
      if (head) head.style.left = `${Math.min(100, Math.max(0, (audio.currentTime / span) * 100))}%`;
    };
    const start = () => { if (!frame.current) frame.current = window.requestAnimationFrame(tick); };
    function tick() {
      frame.current = 0;
      place();
      if (!audio.paused || scrubbing.current) start();
    }
    place();
    audio.addEventListener("play", start);
    audio.addEventListener("seeking", place);
    audio.addEventListener("seeked", place);
    audio.addEventListener("timeupdate", place);
    return () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      audio.removeEventListener("play", start);
      audio.removeEventListener("seeking", place);
      audio.removeEventListener("seeked", place);
      audio.removeEventListener("timeupdate", place);
    };
  }, [media, duration]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas || !peaksRef.current) return;
    const width = canvas.parentElement?.clientWidth ?? 0;
    if (width <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const height = 88;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);
    const peaks = peaksRef.current;
    const styles = getComputedStyle(canvas);
    const colour = styles.color || "#7d8498";
    const middle = height / 2;
    const bars = Math.min(peaks.length, Math.floor(width / 2));
    const step = peaks.length / bars;
    context.fillStyle = colour;
    context.globalAlpha = 0.5;
    for (let bar = 0; bar < bars; bar += 1) {
      const value = peaks[Math.floor(bar * step)] ?? 0;
      const extent = Math.max(1, value * (middle - 6));
      context.fillRect(bar * 2, middle - extent, 1.4, extent * 2);
    }
    context.globalAlpha = 1;
  }

  function seekAt(clientX: number) {
    const wrap = wrapRef.current;
    const element = media.current;
    if (!wrap || !element || duration <= 0) return;
    const rect = wrap.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    try { element.currentTime = ratio * duration; } catch { /* metadata not ready */ }
    const head = playheadRef.current;
    if (head) head.style.left = `${ratio * 100}%`;
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    scrubbing.current = true;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer already gone */ }
    seekAt(event.clientX);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubbing.current) return;
    seekAt(event.clientX);
  }

  function onPointerUp() {
    scrubbing.current = false;
  }

  return (
    <div className={`lxe-wave is-${state}`} ref={wrapRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <canvas ref={canvasRef} className="lxe-wave-canvas" aria-hidden="true" />
      <div className="lxe-wave-head" ref={playheadRef} aria-hidden="true" />
      {state !== "ready" && <p className="lxe-wave-note">{state === "loading" ? "Reading the waveform…" : "Waveform unavailable for this file — the times below still work."}</p>}
    </div>
  );
}
