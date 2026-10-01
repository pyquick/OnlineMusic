"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { hasTiming, lineAt, lineEnd, lineFill, tokenProgress, type LyricsDoc } from "@/shared/lyrics";

/**
 * The playback synchroniser — the engine between the timeline and the renderer.
 *
 * It reads the media element directly, never through React state, and answers one question per
 * animation frame: which line is live, which token inside it, how far through. Only the *line*
 * crossing is React state (a handful of times per song); the token fill is a CSS custom property
 * written straight onto the live spans. A frame therefore costs one `currentTime` read and one or
 * two style writes, and never a re-render. While the media is paused and no scroll is settling,
 * the loop is not running at all.
 */
export type LyricsSync = {
  /** Attach to the scrolling container that holds the rail. */
  containerRef: RefObject<HTMLDivElement>;
  /** The line the view keeps centred; -1 before the first one starts. */
  activeLine: number;
  /** True while `activeLine` is inside its own span (false in the gap after it ends). */
  active: boolean;
};

/** How long a manual scroll parks the auto-centring before it takes the view back. */
const SUSPEND_MS = 4000;
/** The scroll easing's approach per frame; small enough to read as motion, not as a jump. */
const EASE = 0.22;

export function useLyricsSync(media: RefObject<HTMLMediaElement | null>, doc: LyricsDoc | null): LyricsSync {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ line: number; active: boolean }>({ line: -1, active: false });
  const stateRef = useRef(state);
  const frame = useRef(0);
  const target = useRef<number | null>(null);
  const suspendedUntil = useRef(0);
  const pendingScroll = useRef(false);
  const painted = useRef({ line: -2, index: -2 });
  const spans = useRef<HTMLElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const element = media.current;
    const timed = doc && hasTiming(doc) ? doc : null;
    if (!container || !element || !timed) {
      stateRef.current = { line: -1, active: false };
      setState(stateRef.current);
      return;
    }
    // Aliases: the guard above narrows these to non-null for the effect body, but the sync
    // closures run on their own schedule, so they hold the narrowed values by name.
    const sheet = container;
    const audio = element;
    const lyrics = timed;
    const rail = sheet.firstElementChild as HTMLElement | null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    painted.current = { line: -2, index: -2 };
    spans.current = [];

    /**
     * (window height − block height) / 2 of padding on the rail lets any line reach the middle of
     * the window, which is what the whole reading hangs on. The first block's measured height is
     * also published as `--lyr-block`, because the phone's three-block window sizes itself from
     * it without knowing whether the lines carry translations.
     */
    function pad() {
      const first = rail?.querySelector(".lyr-line") as HTMLElement | null;
      const block = first?.offsetHeight ?? 34;
      const value = Math.max(0, (sheet.clientHeight - block) / 2);
      if (rail) {
        rail.style.paddingTop = `${value}px`;
        rail.style.paddingBottom = `${value}px`;
        rail.style.setProperty("--lyr-block", `${block}px`);
      }
    }

    function lineTop(index: number): number | null {
      const line = rail?.children[index] as HTMLElement | undefined;
      if (!line) return null;
      return Math.max(0, line.offsetTop - (sheet.clientHeight - line.offsetHeight) / 2);
    }

    function jumpToLine(index: number) {
      const value = lineTop(index);
      if (value === null) return;
      target.current = null;
      sheet.scrollTop = value;
    }

    function scrollToLine(index: number) {
      const value = lineTop(index);
      if (value === null) return;
      if (reduced) {
        target.current = null;
        sheet.scrollTop = value;
        return;
      }
      target.current = value;
    }

    function paint(line: number, t: number) {
      const entry = lyrics.lines[line];
      if (!entry) return;
      if (painted.current.line !== line) {
        painted.current = { line, index: -2 };
        spans.current = Array.from(sheet.querySelectorAll<HTMLElement>(`[data-lyr-line="${line}"] .lyr-token`));
      }
      if (!entry.tokens?.length) {
        const span = spans.current[0];
        if (span) span.style.setProperty("--lyr-fill", `${(lineFill(lyrics, line, t) * 100).toFixed(2)}%`);
        return;
      }
      const progress = tokenProgress(entry, t);
      if (painted.current.index !== progress.index) {
        for (let index = 0; index < spans.current.length; index += 1) {
          spans.current[index].style.setProperty("--lyr-fill", index < progress.index ? "100%" : "0%");
        }
        painted.current.index = progress.index;
      }
      if (progress.index >= 0 && progress.index < spans.current.length) {
        spans.current[progress.index].style.setProperty("--lyr-fill", `${(progress.fill * 100).toFixed(2)}%`);
      }
    }

    function apply() {
      const t = audio.currentTime || 0;
      const focus = lineAt(lyrics, t);
      const active = focus >= 0 && t < lineEnd(lyrics, focus);
      const previous = stateRef.current;
      if (previous.line !== focus || previous.active !== active) {
        stateRef.current = { line: focus, active };
        setState(stateRef.current);
        if (focus >= 0) {
          if (performance.now() < suspendedUntil.current) pendingScroll.current = true;
          else scrollToLine(focus);
        }
      }
      paint(focus, t);
      if (target.current !== null) {
        const delta = target.current - sheet.scrollTop;
        if (Math.abs(delta) < 0.6) {
          sheet.scrollTop = target.current;
          target.current = null;
        } else sheet.scrollTop += delta * EASE;
      }
      // A manual scroll parks the centring; once it expires the view returns to the live line.
      if (pendingScroll.current && performance.now() >= suspendedUntil.current && focus >= 0) {
        pendingScroll.current = false;
        scrollToLine(focus);
      }
    }

    function start() {
      if (!frame.current) frame.current = window.requestAnimationFrame(tick);
    }

    function tick() {
      frame.current = 0;
      apply();
      if (!audio.paused || target.current !== null) start();
    }

    const onSeek = () => start();
    let resume = 0;
    const suspend = () => {
      suspendedUntil.current = performance.now() + SUSPEND_MS;
      window.clearTimeout(resume);
      resume = window.setTimeout(() => {
        pendingScroll.current = true;
        start();
      }, SUSPEND_MS);
    };

    pad();
    apply();
    if (stateRef.current.line >= 0) jumpToLine(stateRef.current.line);
    audio.addEventListener("play", onSeek);
    audio.addEventListener("seeking", onSeek);
    audio.addEventListener("seeked", onSeek);
    audio.addEventListener("timeupdate", onSeek);
    audio.addEventListener("loadedmetadata", onSeek);
    sheet.addEventListener("wheel", suspend, { passive: true });
    sheet.addEventListener("touchstart", suspend, { passive: true });
    const observer = new ResizeObserver(() => {
      pad();
      if (stateRef.current.line >= 0) jumpToLine(stateRef.current.line);
    });
    observer.observe(sheet);
    return () => {
      if (frame.current) window.cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.clearTimeout(resume);
      observer.disconnect();
      audio.removeEventListener("play", onSeek);
      audio.removeEventListener("seeking", onSeek);
      audio.removeEventListener("seeked", onSeek);
      audio.removeEventListener("timeupdate", onSeek);
      audio.removeEventListener("loadedmetadata", onSeek);
      sheet.removeEventListener("wheel", suspend);
      sheet.removeEventListener("touchstart", suspend);
    };
  }, [doc, media]);

  return { containerRef, activeLine: state.line, active: state.active };
}
