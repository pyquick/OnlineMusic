/**
 * The glass feature — its public data API.
 *
 * Data, not runtime: the dials' limits and defaults, the saved shape and the pure readers and
 * writers around it. The *system* — live state, the engines' lifecycle, when a blob is restored
 * and written — lives in `useGlassSystem`, which the page mounts through its own entry, the same
 * split the appearance feature uses between its index and its view. Keeping this file free of the
 * hook is load-bearing: the settings view (a lazy chunk) imports from here, and if this barrel
 * re-exported the runtime it would drag the engines back into that chunk.
 */
export {
  BAND_PERCENT_TO_PX, DEFAULT_GLASS_BLUR, DEFAULT_GLASS_CLARITY, DEFAULT_GLASS_DISPERSION,
  DEFAULT_GLASS_EDGE, DEFAULT_GLASS_RADIUS, DEFAULT_GLASS_REFRACTION, DEFAULT_GLASS_SETTINGS,
  GLASS_BLUR_STEP, MAX_BAND_PX, MAX_EDGE_OFFSET, MAX_GLASS_BLUR,
  glassStoredFields, readGlassSettings,
  type GlassGroup, type GlassGroupValues, type GlassSettings, type StoredGlassFields,
} from "./model";
