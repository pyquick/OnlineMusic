/**
 * The appearance feature — its public API.
 *
 * This entry point carries **data, not UI**: the saved shape, its defaults, the presets and the
 * pure helpers. The page restores a saved blob on first paint, so it needs these synchronously;
 * the settings *view* is only ever on screen after a click, so it lives behind its own entry
 * (`./AppearanceSettings`, loaded with `next/dynamic`). Keeping the two apart is load-bearing, not
 * stylistic: while this file also re-exported the view, importing a default from here pulled the
 * whole settings page — and its icons — into the first load, and the split saved nothing.
 */
export {
  BAND_PERCENT_TO_PX, DEFAULT_APPEARANCE, DEFAULT_GLASS_BLUR, DEFAULT_GLASS_CLARITY,
  DEFAULT_GLASS_DISPERSION, DEFAULT_GLASS_EDGE, DEFAULT_GLASS_RADIUS, DEFAULT_GLASS_REFRACTION,
  GLASS_BLUR_STEP, GRADIENT_PRESETS, MAX_GLASS_BLUR, SOLID_PRESETS, TINT_PRESETS,
  hexToRgb, hexLuma, prepareBackgroundImage, rgbToHex, tintChannels, type Appearance,
} from "./model";
