"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { attachGlassEdge } from "@/lib/glassEdge";
import { attachGlassWebgpu, type GlassWebgpuHandle } from "@/lib/glassWebgpu";
import { setAutoShade, startInkSampler, touchScene } from "@/lib/inkSampler";
import { SETTINGS_STORAGE_KEY } from "@/shared/utilities/settings";
import type { Appearance } from "@/features/appearance";
import { DEFAULT_GLASS_SETTINGS, glassStoredFields, readGlassSettings, type GlassSettings, type StoredGlassFields } from "./model";

/**
 * The event functional code dispatches (bubbling, from the element whose box moved silently) to
 * have the rims redraw at the new box without re-rasterising. The name is the whole contract; the
 * phone pill's bubble is the only sender (see app/bottom-pill.tsx). A DOM event, not a handle,
 * so no feature has to import the glass system to talk to it.
 */
const GLASS_REFRESH_EVENT = "glass-refresh";

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
  const webgpuRef = useRef<GlassWebgpuHandle | null>(null);
  const edgeRef = useRef<ReturnType<typeof attachGlassEdge> | null>(null);
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

  // The rims attach once per renderer choice. The edge map is the default and needs nothing to
  // start; the stored "WebGPU rendering" switch asks for the shader instead, and WebKit takes it
  // whatever the switch says — it cannot bend a backdrop in CSS at all, and WebGPU is on there by
  // default. A device that never arrives hands the shell back here through `onUnavailable`, so a
  // pane is never left with a canvas nobody paints, and the stylesheet's shaded rim is the floor
  // under both. The dials of the moment are pushed explicitly on attach, where the push effects
  // below would not re-fire for values that did not change.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const current = latest.current;
    const attachEdge = () => {
      const glass = attachGlassEdge(element);
      glass.setOffset(current.edge);
      glass.setRefraction(current.refraction);
      glass.setDispersion(current.dispersion / 100);
      glass.setGroups(current.groups);
      edgeRef.current = glass;
    };
    const webgpu = attachGlassWebgpu(
      element,
      { blur: current.blur, clarity: current.clarity / 100, offset: current.edge, band: current.refraction, radius: current.radius / 100, dispersion: current.dispersion / 100 },
      current.webgpu,
      attachEdge,
    );
    if (webgpu) {
      webgpuRef.current = webgpu;
      return () => { webgpuRef.current = null; webgpu.destroy(); edgeRef.current?.destroy(); edgeRef.current = null; };
    }
    attachEdge();
    return () => { edgeRef.current?.destroy(); edgeRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.webgpu]);

  // The ink sampler reads the shell's own luma and writes every pane's ink, shade and glow. The
  // root is handed in, so the engine never has to know the shell's class name.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    return startInkSampler(element);
  }, [shell]);

  // The dials, pushed live: the shader re-draws the band from the raster it already holds — and
  // re-reads the veil clarity just rewrote — so moving one never costs a rasterisation. The tint
  // rides along because the band carries it too, and a colour the flat middle has already changed
  // to must not wait on the next slider move to reach the rim.
  useEffect(() => {
    webgpuRef.current?.setParameters({ blur, clarity: clarity / 100, offset: edge, band: refraction, radius: radius / 100, dispersion: dispersion / 100 });
  }, [blur, clarity, edge, refraction, radius, dispersion, appearance.tint]);
  useEffect(() => { edgeRef.current?.setOffset(edge); }, [edge]);
  // The per-family bases. Absent families follow the dials, so only the overrides travel.
  useEffect(() => {
    webgpuRef.current?.setGroups(groups);
    edgeRef.current?.setGroups(groups);
  }, [groups]);
  useEffect(() => { edgeRef.current?.setRefraction(refraction); }, [refraction]);
  useEffect(() => { edgeRef.current?.setDispersion(dispersion / 100); }, [dispersion]);

  // The tint and the backdrop's brightness are attributes on one element and raise no event a
  // scene could hear, so every appearance change re-reads the scene.
  useEffect(() => {
    setAutoShade(appearance.shade);
    touchScene();
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
      webgpuRef.current?.refresh();
      if (now - start < TINT_TRANSITION_MS) frame = requestAnimationFrame(chase);
    });
    return () => cancelAnimationFrame(frame);
  }, [appearance.tint]);

  // A pane whose box moved without a DOM signal (the pill's bubble, mid-spring) tells the rims so
  // they redraw at the new box on the next frame instead of at the next settle tick. Only the
  // WebGPU path has a surface to redraw; the edge map follows its own geometry.
  useEffect(() => {
    const onRefresh = () => webgpuRef.current?.refresh();
    const onAmbient = () => webgpuRef.current?.invalidate();
    document.addEventListener(GLASS_REFRESH_EVENT, onRefresh);
    document.addEventListener("glass-ambient-change", onAmbient);
    return () => {
      document.removeEventListener(GLASS_REFRESH_EVENT, onRefresh);
      document.removeEventListener("glass-ambient-change", onAmbient);
    };
  }, []);

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
