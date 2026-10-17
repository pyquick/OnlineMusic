/**
 * The parameter model's public API — the same surface the page, the parameter editor and the
 * server's metadata validation all import, so a document written by one is read by the other.
 */
export {
  DEFAULT_TRACK_PARAMETERS,
  DEFAULT_WAVEFORM_SETTINGS,
  PARAMETER_LIMITS,
  parametersEqual,
  patchParameters,
  type CompressorParameters,
  type EqBands,
  type LoopRegion,
  type ParameterPatch,
  type TrackParameters,
  type WaveformSettings,
} from "./types";
export { clampNumber, sanitizeTrackParameters, sanitizeWaveformSettings, storedParameters } from "./validation";
export { PARAMETER_PRESETS, applyPreset, type ParameterPreset } from "./presets";
