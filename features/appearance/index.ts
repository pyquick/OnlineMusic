/**
 * The appearance feature — its public API.
 *
 * This entry point carries **data, not UI**: the saved shape, its defaults, the presets and the
 * pure helpers. The page restores a saved blob on first paint, so it needs these synchronously;
 * the settings *view* is only ever on screen after a click, so it lives behind its own entry
 * (`./AppearanceSettings`, loaded with `next/dynamic`). Keeping the two apart is load-bearing, not
 * stylistic: while this file also re-exported the view, importing a default from here pulled the
 * whole settings page — and its icons — into the first load, and the split saved nothing.
 *
 * The glass dials and their limits used to live in this feature too; they moved to features/glass,
 * where the rest of the Liquid Glass system lives.
 */
export {
  DEFAULT_APPEARANCE, GRADIENT_PRESETS, SOLID_PRESETS, TINT_PRESETS,
  hexToRgb, hexLuma, prepareBackgroundImage, rgbToHex, tintChannels, type Appearance,
} from "./model";
