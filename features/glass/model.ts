/**
 * The glass model: the Liquid Glass system's data — the seven dials, their per-family overrides
 * and the stored shape — as values and pure functions.
 *
 * This is the glass feature's public data surface. Functional code (the page, the settings view)
 * reads the limits, types and readers from *here*, never from an engine; the optics constants an
 * engine owns are re-exported so the direction of knowledge stays features → lib. Nothing in this
 * file touches React or the DOM, which is what lets the first-paint path restore a saved blob
 * without dragging the runtime — or any engine — along.
 */

import { MAX_BAND_PX, MAX_EDGE_OFFSET, type GlassGroup, type GlassGroupValues } from "@/lib/glassEdge";

export { MAX_BAND_PX, MAX_EDGE_OFFSET };
export type { GlassGroup, GlassGroupValues };

/** Backdrop blur in px for every frosted pane, and the corner-radius multiplier behind it. */
export const MAX_GLASS_BLUR = 30;
export const DEFAULT_GLASS_BLUR = 12;
/**
 * The blur the slider steps in, in px. The first pixel of blur is the one that matters — on a 2×
 * display a whole px is two device pixels, and the difference between none and that is the coarse
 * jump the dial used to have — so the dial is cut into tenths, and 0.1px is a haze you can barely
 * name rather than the switch that 1px was.
 */
export const GLASS_BLUR_STEP = 0.1;
export const DEFAULT_GLASS_RADIUS = 100;
/** Clarity runs the other way: 100% is nearly clear glass, 0% is an opaque milky pane. */
export const DEFAULT_GLASS_CLARITY = 60;
/** How far the rim pulls the backdrop inward, in px. */
export const DEFAULT_GLASS_EDGE = 9;
/**
 * The master rainbow, 0–100: the share of the rim's bend each colour channel separates by, scaled
 * per pane by the measured brightness behind it. On by default — it is the one dial every control
 * answers to at once, and a fresh install should show what it does.
 */
export const DEFAULT_GLASS_DISPERSION = 50;
/** How far in from the edge the bend reaches, in px — the same band on every pane and edge. */
export const DEFAULT_GLASS_REFRACTION = 30;
/** Settings saved before the band became a width held a percent of the pane's short side. */
export const BAND_PERCENT_TO_PX = 2.5;

/**
 * The seven dials, live: what Settings edits, what the shell publishes as custom properties and
 * what both rim engines are pushed. `refraction` is a px width (the band) and `edge` is a px pull
 * (how hard the rim bends); the stored blob keeps their historical names — see glassStoredFields.
 */
export type GlassSettings = {
  blur: number;
  radius: number;
  clarity: number;
  edge: number;
  refraction: number;
  dispersion: number;
  /** Per-family overrides; a family absent here follows the studio's own values. */
  groups: GlassGroupValues;
};

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
  blur: DEFAULT_GLASS_BLUR,
  radius: DEFAULT_GLASS_RADIUS,
  clarity: DEFAULT_GLASS_CLARITY,
  edge: DEFAULT_GLASS_EDGE,
  refraction: DEFAULT_GLASS_REFRACTION,
  dispersion: DEFAULT_GLASS_DISPERSION,
  groups: {},
};

/** The known families, so a stored blob cannot invent one; each value is clamped like the sliders. */
const GLASS_GROUP_NAMES = ["pane", "card", "button", "field", "chip", "capsule", "tile"] as const;

function readStoredGroups(raw: unknown): GlassGroupValues {
  if (!raw || typeof raw !== "object") return {};
  const out: GlassGroupValues = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(GLASS_GROUP_NAMES as readonly string[]).includes(name)) continue;
    const entry = value as { band?: unknown; pull?: unknown } | null;
    const band = Number(entry?.band);
    const pull = Number(entry?.pull);
    if (!Number.isFinite(band) || !Number.isFinite(pull)) continue;
    out[name as (typeof GLASS_GROUP_NAMES)[number]] = {
      band: Math.round(Math.max(0, Math.min(MAX_BAND_PX, band))),
      pull: Math.max(0, Math.min(MAX_EDGE_OFFSET, pull)),
    };
  }
  return out;
}

/**
 * The glass dials out of a stored settings blob (already JSON-parsed). Every value is clamped to
 * its slider's range and a family the build no longer knows is dropped. The band needs care: it
 * is stored as px under the historical key `glassBandPx`, and a blob older than that change held
 * a percent of the pane's short side under `glassRefraction` — that one is scaled on the way in.
 */
export function readGlassSettings(data: unknown): GlassSettings {
  if (!data || typeof data !== "object") return DEFAULT_GLASS_SETTINGS;
  const stored = data as { glassBandPx?: unknown; glassRefraction?: unknown };
  const bandPx = typeof stored.glassBandPx === "number"
    ? stored.glassBandPx
    : typeof stored.glassRefraction === "number"
      ? stored.glassRefraction * BAND_PERCENT_TO_PX
      : DEFAULT_GLASS_SETTINGS.refraction;
  const number = (value: unknown, fallback: number) => (typeof value === "number" ? value : fallback);
  const record = data as Record<string, unknown>;
  return {
    blur: Math.max(0, Math.min(MAX_GLASS_BLUR, number(record.glassBlur, DEFAULT_GLASS_SETTINGS.blur))),
    radius: Math.max(50, Math.min(150, number(record.glassRadius, DEFAULT_GLASS_SETTINGS.radius))),
    clarity: Math.max(0, Math.min(100, number(record.glassClarity, DEFAULT_GLASS_SETTINGS.clarity))),
    edge: Math.max(0, Math.min(MAX_EDGE_OFFSET, number(record.glassEdge, DEFAULT_GLASS_SETTINGS.edge))),
    refraction: Math.round(Math.max(0, Math.min(MAX_BAND_PX, bandPx))),
    dispersion: Math.round(Math.max(0, Math.min(100, number(record.glassDispersion, DEFAULT_GLASS_SETTINGS.dispersion)))),
    groups: readStoredGroups(record.glassGroups),
    // Strict on purpose: a stray truthy value in a hand-edited blob must not switch renderers.
  };
}

/**
 * The flat fields the page writes into the settings blob, in the stored order. The names are the
 * contract with every previously saved browser (and the manual probes in docs/), so `refraction`
 * keeps its historical key `glassBandPx` — renaming it would silently reset every user's band.
 */
export function glassStoredFields(settings: GlassSettings) {
  return {
    glassBlur: settings.blur,
    glassRadius: settings.radius,
    glassClarity: settings.clarity,
    glassEdge: settings.edge,
    glassBandPx: settings.refraction,
    glassDispersion: settings.dispersion,
    glassGroups: settings.groups,
    // Appended after the historical names: an older blob simply omits it and reads back as false.
  };
}

export type StoredGlassFields = ReturnType<typeof glassStoredFields>;
