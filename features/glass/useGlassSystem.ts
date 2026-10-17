"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { attachGlassEdge } from "@/lib/glassEdge";
import { attachGlassRainbow } from "@/lib/glassRainbow";
import { setAutoShade, startInkSampler, touchScene } from "@/lib/inkSampler";
import { SETTINGS_STORAGE_KEY } from "@/shared/utilities/settings";
import type { Appearance } from "@/features/appearance";
import { DEFAULT_GLASS_SETTINGS, glassStoredFields, readGlassSettings, type GlassSettings, type StoredGlassFields } from "./model";

/**
 * The events functional code dispatches when it knows something behind the glass changed. The
 * names are the whole contract; the phone pill's bubble is the sender of `glass-refresh` (its box
 * moved silently, see app/bottom-pill.tsx) and the ambient drift sends `glass-ambient-change` (the
 * orbs are part of the captured backdrop). DOM events, not handles, so no feature has to import
 * the glass system to talk to it.
 */

/** How long a colour change takes to cross the glass, in ms. The stylesheet interpolates the tint
    channels over the same span — it reads `--tint-duration`, which the style object below
    publishes — so the veil, the rims and the sampler all ride one clock. */
const TINT_TRANSITION_MS = 600;
/** While that runs, how often the scene is re-read: quick enough that the type glides with the
    colour, slow enough that the sampler's own work stays far below the frame rate. */
const TINT_SAMPLE_MS = 80;

export type GlassSystem = {
  settings: GlassSettings;
  /** Patch one or more dials; the engines and the shell's custom properties follow immediately. */
  update: (patch: Partial<GlassSettings>) => void;
  /** The shell's glass custom properties, spread into its inline style. */
  style: CSSProperties;
  /** The flat field set the settings blob carries, in its stored order. */
  stored: StoredGlassFields;
  /** True once a stored blob has been read, so a first write cannot clobber it. */
  ready: boolean;
};

/**
 * The Liquid Glass system, mounted once by the page. It owns the dials and their stored form, and
 * every engine that turns them into pixels — functional code talks to it through this handle and
 * through the declarative DOM markers the stylesheet and the engines already share, never through
 * the engines directly.
 */
export function useGlassSystem(shell: RefObject<HTMLElement | null>, appearance: Appearance): GlassSystem {
  const [settings, setSettings] = useState<GlassSettings>(DEFAULT_GLASS_SETTINGS);
  const [ready, setReady] = useState(false);
  const edgeRef = useRef<ReturnType<typeof attachGlassEdge> | null>(null);
  const rainbowRef = useRef<ReturnType<typeof attachGlassRainbow> | null>(null);
  /** The dials of the latest render, so a re-attach can push them without depending on them. */
  const latest = useRef(settings);
  latest.current = settings;

  const update = useCallback((patch: Partial<GlassSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

  // The colour transition is armed only after the first paint: a tint restored from the settings
  // blob would otherwise glide in from the neutral default every time the studio loads.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => element.setAttribute("data-tint-live", ""));
    return () => cancelAnimationFrame(frame);
  }, [shell]);

  // Restore before first paint, so the page's write effect cannot clobber a stored blob with
  // defaults. `ready` is set even when the blob is unusable: the page gates its persistence on
  // it, and a parse failure here must not silently stop everything else from being saved.
  useLayoutEffect(() => {
    let restored = DEFAULT_GLASS_SETTINGS;
    try {
      const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (stored) restored = readGlassSettings(JSON.parse(stored));
    } catch {
      // Not JSON at all: the defaults stand, exactly as the page's own reader treats it.
    } finally {
      setSettings(restored);
      setReady(true);
    }
  }, []);

  const { blur, clarity, edge, refraction, radius, dispersion, groups } = settings;

  /**
   * The two rim engines. The SVG map bends every pane and paints the rainbow whenever the GPU
   * engine is not doing it; the WebGPU engine takes the colour split over while the dial is above
   * zero and hands it back at zero. Both are attached for the shell's lifetime.
   */
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const current = latest.current;
    const glass = attachGlassEdge(element);
    glass.setOffset(current.edge);
    glass.setRefraction(current.refraction);
    glass.setDispersion(current.dispersion / 100);
    glass.setGroups(current.groups);
    edgeRef.current = glass;
    // The GPU engine keeps the SVG bend underneath its canvas, so the handoff only ever toggles
    // the split: a device that never arrives still leaves a bent rim, and a stopped GPU never
    // leaves the band colourless.
    const rainbow = attachGlassRainbow(
      element,
      {
        blur: current.blur,
        clarity: current.clarity / 100,
        offset: current.edge,
        band: current.refraction,
        radius: current.radius / 100,
        dispersion: current.dispersion / 100,
      },
      (owned) => glass.setExternalDispersion(owned),
    );
    rainbowRef.current = rainbow;
    return () => {
      rainbow?.destroy();
      rainbowRef.current = null;
      edgeRef.current?.destroy();
      edgeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every dial the band is drawn from. The GPU engine is told as one object — it reads all six,
  // and the dispersion value alone decides whether it draws at all.
  useEffect(() => {
    rainbowRef.current?.setParameters({ blur, clarity: clarity / 100, offset: edge, band: refraction, radius: radius / 100, dispersion: dispersion / 100 });
  }, [blur, clarity, edge, refraction, radius, dispersion]);

  // The ink sampler reads the shell's own luma and writes every pane's ink, shade and glow. The
  // root is handed in, so the engine never has to know the shell's class name.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    return startInkSampler(element);
  }, [shell]);

  useEffect(() => { edgeRef.current?.setOffset(edge); }, [edge]);
  // The per-family bases. Absent families follow the dials, so only the overrides travel.
  useEffect(() => {
    edgeRef.current?.setGroups(groups);
    rainbowRef.current?.setGroups(groups);
  }, [groups]);
  useEffect(() => { edgeRef.current?.setRefraction(refraction); }, [refraction]);
  useEffect(() => { edgeRef.current?.setDispersion(dispersion / 100); }, [dispersion]);

  // The two signals the CSS-driven parts of the scene emit. A pane whose box moved without a DOM
  // event (the pill's bubble, mid-spring) only needs a redraw; the ambient orbs moving change what
  // the captured raster holds, so they ask for a new one.
  useEffect(() => {
    const onRefresh = () => rainbowRef.current?.refresh();
    const onAmbient = () => rainbowRef.current?.invalidate();
    document.addEventListener("glass-refresh", onRefresh);
    document.addEventListener("glass-ambient-change", onAmbient);
    return () => {
      document.removeEventListener("glass-refresh", onRefresh);
      document.removeEventListener("glass-ambient-change", onAmbient);
    };
  }, []);

  // The tint and the backdrop's brightness are attributes on one element and raise no event a
  // scene could hear, so every appearance change re-reads the scene. A new backdrop is also a new
  // raster: the GPU band samples the page, not the pane's own CSS.
  useEffect(() => {
    setAutoShade(appearance.shade);
    touchScene();
    rainbowRef.current?.invalidate();
  }, [appearance]);

  // A tint change is a transition, not a jump: the stylesheet interpolates the channel variables
  // while the band — which samples those variables from each pane's computed style only when it
  // is asked to draw — would otherwise keep the colour the change began with. So the engines are
  // carried through the whole trip, and the sampler is nudged along the way, or the type would
  // still be reading the old colour when the glass had already arrived.
  const shownTint = useRef(appearance.tint);
  useEffect(() => {
    if (shownTint.current === appearance.tint) return;
    shownTint.current = appearance.tint;
    const start = performance.now();
    let sampled = start;
    let frame = requestAnimationFrame(function chase(now) {
      if (now - sampled >= TINT_SAMPLE_MS) { sampled = now; touchScene(); }
      // The band reads the tint from each pane's computed style at draw time; carry it through
      // the same transition the stylesheet is running.
      rainbowRef.current?.refresh();
      if (now - start < TINT_TRANSITION_MS) frame = requestAnimationFrame(chase);
    });
    return () => cancelAnimationFrame(frame);
  }, [appearance.tint]);

  // What the shell publishes for the stylesheet and the rim map. The formats are the contract
  // (a bare number, px with the unit, the clarity and radius as fractions).
  const style = useMemo(() => ({
    "--glass-radius": String(radius / 100),
    "--glass-blur": `${blur}px`,
    "--glass-clarity": String(clarity / 100),
    "--glass-band": `${refraction}px`,
    "--glass-pull": String(edge),
    "--tint-duration": `${TINT_TRANSITION_MS}ms`,
  } as CSSProperties), [radius, blur, clarity, refraction, edge]);

  const stored = useMemo(() => glassStoredFields(settings), [settings]);

  return { settings, update, style, stored, ready };
}
