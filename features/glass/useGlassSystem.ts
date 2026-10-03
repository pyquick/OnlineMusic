"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { attachGlassEdge } from "@/lib/glassEdge";
import { attachGlassWebgl, type GlassWebglHandle } from "@/lib/glassWebgl";
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
  const webglRef = useRef<GlassWebglHandle | null>(null);
  const edgeRef = useRef<ReturnType<typeof attachGlassEdge> | null>(null);
  /** The dials of the latest render, so a re-attach can push them without depending on them. */
  const latest = useRef(settings);
  latest.current = settings;

  const update = useCallback((patch: Partial<GlassSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
  }, []);

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

  // The rims attach once per engine choice: SVG in Chromium, WebGL where CSS cannot bend a
  // backdrop (Safari, always; Chromium when the stored "WebGL rendering" switch asks for it). A
  // WebGL build that cannot start falls through to the SVG path, and thence to the stylesheet's
  // shaded rim, so a pane is never left without something at its edges. The effect re-runs only
  // when the switch flips — so the dials of the moment are pushed explicitly on attach, where
  // the push effects below would not re-fire for values that did not change.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const current = latest.current;
    const webgl = attachGlassWebgl(element, { blur: current.blur, clarity: current.clarity / 100, offset: current.edge, band: current.refraction, radius: current.radius / 100, dispersion: current.dispersion / 100 }, current.webgl);
    if (webgl) {
      webgl.setGroups(current.groups);
      webglRef.current = webgl;
      return () => { webgl.destroy(); webglRef.current = null; };
    }
    const glass = attachGlassEdge(element);
    glass.setOffset(current.edge);
    glass.setRefraction(current.refraction);
    glass.setDispersion(current.dispersion / 100);
    glass.setGroups(current.groups);
    edgeRef.current = glass;
    return () => { glass.destroy(); edgeRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.webgl]);

  // The ink sampler reads the shell's own luma and writes every pane's ink, shade and glow. The
  // root is handed in, so the engine never has to know the shell's class name.
  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    return startInkSampler(element);
  }, [shell]);

  // The dials, pushed live: the band re-draws from the raster it already has — and re-reads the
  // veil clarity just rewrote — so moving one never costs a rasterisation. The tint rides along
  // because the band carries it too, and a colour the flat middle has already changed to must not
  // wait on the next slider move to reach the rim.
  useEffect(() => {
    webglRef.current?.setParameters({ blur, clarity: clarity / 100, offset: edge, band: refraction, radius: radius / 100, dispersion: dispersion / 100 });
  }, [blur, clarity, edge, refraction, radius, dispersion, appearance.tint]);
  useEffect(() => { edgeRef.current?.setOffset(edge); }, [edge]);
  // The per-family bases. Absent families follow the dials, so only the overrides travel.
  useEffect(() => {
    webglRef.current?.setGroups(groups);
    edgeRef.current?.setGroups(groups);
  }, [groups]);
  useEffect(() => { edgeRef.current?.setRefraction(refraction); }, [refraction]);
  // The master rainbow reaches both engines: the WebGL one above, the SVG map here.
  useEffect(() => { edgeRef.current?.setDispersion(dispersion / 100); }, [dispersion]);

  // The tint and the backdrop's brightness are attributes on one element and raise no event a
  // scene could hear, so every appearance change re-reads the scene.
  useEffect(() => {
    setAutoShade(appearance.shade);
    touchScene();
  }, [appearance]);

  // A pane whose box moved without a DOM signal (the pill's bubble, mid-spring) tells the rims so
  // they redraw at the new box on the next frame instead of at the next settle tick. Only the
  // WebGL path has a band to redraw; the SVG map follows its own geometry.
  useEffect(() => {
    const onRefresh = () => webglRef.current?.refresh();
    document.addEventListener(GLASS_REFRESH_EVENT, onRefresh);
    return () => document.removeEventListener(GLASS_REFRESH_EVENT, onRefresh);
  }, []);

  // What the shell publishes for the stylesheet and both engines. The formats are the contract
  // (a bare number, px with the unit, the clarity and radius as fractions).
  const style = useMemo(() => ({
    "--glass-radius": String(radius / 100),
    "--glass-blur": `${blur}px`,
    "--glass-clarity": String(clarity / 100),
    "--glass-band": `${refraction}px`,
    "--glass-pull": String(edge),
  } as CSSProperties), [radius, blur, clarity, refraction, edge]);

  const stored = useMemo(() => glassStoredFields(settings), [settings]);

  return { settings, update, style, stored, ready };
}
