/**
 * The appearance model: what the studio looks like, as data.
 *
 * Everything here is a value or a pure function — no React, no browser APIs beyond the
 * canvas the backdrop shrinker needs. The view (AppearanceSettings.tsx) reads it and the
 * page stores it; neither owns it. That is what lets the same defaults be used by the
 * first-paint path (which restores a saved blob) without dragging the settings UI along.
 */

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
/** How far in from the edge the bend reaches, in px — the same band on every pane and edge. */
export const DEFAULT_GLASS_REFRACTION = 30;
/** Settings saved before the band became a width held a percent of the pane's short side. */
export const BAND_PERCENT_TO_PX = 2.5;

/**
 * Everything about how the studio looks that is not one of the five glass dials. One object, so
 * the store has one field to write and one to read back, and a saved blob from an older build
 * simply leaves the new members at their defaults. Tints are "r g b" channel strings rather than
 * hex: the stylesheet needs the channels separately, and this is the form the now-playing view
 * already uses for its artwork tint.
 */
export type Appearance = {
  tint: string;
  /** Whether the glass darkens itself over a dark backdrop. */
  shade: boolean;
  bgKind: "preset" | "gradient" | "image";
  bgPreset: string;
  bgGradient: string;
  /** A data URI, never a blob: URL — a rasterised SVG cannot fetch a blob. */
  bgImage: string;
  /** How much dark scrim is laid over a photo backdrop, 0–100. */
  bgDim: number;
  /** The backdrop's own brightness, 0–1: drives the page inks and the pane baseline. */
  shellLuma: number;
};

export const DEFAULT_APPEARANCE: Appearance = {
  tint: "255 255 255",
  shade: true,
  // "paper" is the gradient the studio has always painted: a visitor who never opens Settings
  // sees exactly the backdrop they saw before any of this existed.
  bgKind: "gradient",
  bgPreset: "paper",
  bgGradient: "paper",
  bgImage: "",
  bgDim: 0,
  shellLuma: 0.96,
};

export const TINT_PRESETS = [
  { id: "clear", label: "Neutral", rgb: "255 255 255" },
  { id: "warm", label: "Warm", rgb: "255 238 214" },
  { id: "cool", label: "Cool", rgb: "226 238 255" },
  { id: "mint", label: "Mint", rgb: "222 246 233" },
  { id: "rose", label: "Rose", rgb: "255 226 236" },
  { id: "lilac", label: "Lilac", rgb: "233 226 255" },
  { id: "amber", label: "Amber", rgb: "255 224 178" },
  { id: "slate", label: "Slate", rgb: "206 212 224" },
];

export const SOLID_PRESETS = [
  { id: "paper", label: "Paper", color: "#f6f7fb", luma: 0.96 },
  { id: "ivory", label: "Ivory", color: "#f7f3ea", luma: 0.95 },
  { id: "mist", label: "Mist", color: "#eef2f8", luma: 0.94 },
  { id: "sage", label: "Sage", color: "#eef3ee", luma: 0.94 },
  { id: "blush", label: "Blush", color: "#f9eef1", luma: 0.94 },
  { id: "ink", label: "Ink", color: "#14161c", luma: 0.09 },
  { id: "navy", label: "Navy", color: "#0f1a2b", luma: 0.1 },
  { id: "graphite", label: "Graphite", color: "#1d2026", luma: 0.13 },
];

export const GRADIENT_PRESETS = [
  { id: "paper", label: "Paper", css: "linear-gradient(120deg,#f8f9fc 0%,#f2f3fa 55%,#fbfbff 100%)", luma: 0.96 },
  { id: "dawn", label: "Dawn", css: "linear-gradient(120deg,#fdf3e7 0%,#f6e7f0 55%,#eef1fb 100%)", luma: 0.93 },
  { id: "rose", label: "Blossom", css: "linear-gradient(120deg,#fff1f4 0%,#ffe4ec 50%,#f7e6ff 100%)", luma: 0.93 },
  { id: "dusk", label: "Dusk", css: "linear-gradient(120deg,#2a2140 0%,#3b2a52 55%,#1d1b33 100%)", luma: 0.16 },
  { id: "aurora", label: "Aurora", css: "linear-gradient(120deg,#1b2a3a 0%,#20465a 45%,#2f6d63 100%)", luma: 0.26 },
  { id: "deep", label: "Deep", css: "linear-gradient(120deg,#0b1220 0%,#132a44 60%,#0a1a2e 100%)", luma: 0.11 },
];

export function tintChannels(rgb: string): [number, number, number] {
  const [r, g, b] = rgb.split(/\s+/).map((part) => Number(part));
  return [Number.isFinite(r) ? r : 255, Number.isFinite(g) ? g : 255, Number.isFinite(b) ? b : 255];
}

export function rgbToHex(rgb: string) {
  const [r, g, b] = tintChannels(rgb);
  return `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const number = Number.parseInt(full, 16);
  if (!Number.isFinite(number)) return "255 255 255";
  return `${(number >> 16) & 255} ${(number >> 8) & 255} ${number & 255}`;
}

/** Rec. 709 luma of an "#rrggbb" colour, the same weighting the ink sampler scores tiles with. */
export function hexLuma(hex: string) {
  const rgb = hexToRgb(hex).split(" ").map(Number);
  return (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
}

/** Longest side of a stored backdrop. Big enough for a laptop, small enough to keep in localStorage. */
const BACKDROP_MAX = 1600;
const BACKDROP_BUDGET = 2_600_000;

/**
 * Shrinks a chosen photo until it can live in localStorage, and measures it on the way through.
 * A file that will not fit after two tries is refused rather than truncated — the caller keeps
 * nothing, so the studio falls back to the colour that was already chosen.
 */
export async function prepareBackgroundImage(file: File): Promise<{ uri: string; luma: number } | { error: string }> {
  const source = await new Promise<HTMLImageElement | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = String(reader.result);
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
  if (!source) return { error: "That image could not be read." };
  const measure = document.createElement("canvas");
  measure.width = 24;
  measure.height = 24;
  const measureContext = measure.getContext("2d", { willReadFrequently: true });
  measureContext?.drawImage(source, 0, 0, 24, 24);
  const pixels = measureContext?.getImageData(0, 0, 24, 24).data;
  let luma = 0.96;
  if (pixels) {
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
    luma = sum / (pixels.length / 4);
  }
  for (const [max, quality] of [[BACKDROP_MAX, 0.82], [1280, 0.72]] as const) {
    const scale = Math.min(1, max / Math.max(source.naturalWidth, source.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    const uri = canvas.toDataURL("image/jpeg", quality);
    if (uri.length <= BACKDROP_BUDGET) return { uri, luma };
  }
  return { error: "That image is too large to keep in this browser — try a smaller one." };
}
