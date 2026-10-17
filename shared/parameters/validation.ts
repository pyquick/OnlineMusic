import {
  DEFAULT_TRACK_PARAMETERS,
  DEFAULT_WAVEFORM_SETTINGS,
  PARAMETER_LIMITS,
  type CompressorParameters,
  type EqBands,
  type LoopRegion,
  type TrackParameters,
  type WaveformSettings,
} from "./types";

/**
 * Reading parameters that may have been written by anything: this browser, an older build, or a
 * hand-edited metadata blob. It never throws and never invents a number outside the dials, which
 * is what lets the API store a document the client will read back unchanged — the same contract
 * the lyrics validation keeps, pointed at a much simpler shape.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A finite number inside the dials, else the fallback — the one clamp every field goes through. */
export function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: unknown, fallback: number): number {
  return clampNumber(value, 0, 1, fallback);
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function compressor(value: unknown): CompressorParameters {
  const defaults = DEFAULT_TRACK_PARAMETERS.compressor;
  if (!isRecord(value)) return { ...defaults };
  return {
    on: bool(value.on, defaults.on),
    threshold: clampNumber(value.threshold, PARAMETER_LIMITS.threshold.min, PARAMETER_LIMITS.threshold.max, defaults.threshold),
    ratio: clampNumber(value.ratio, PARAMETER_LIMITS.ratio.min, PARAMETER_LIMITS.ratio.max, defaults.ratio),
    attack: clampNumber(value.attack, PARAMETER_LIMITS.attack.min, PARAMETER_LIMITS.attack.max, defaults.attack),
    release: clampNumber(value.release, PARAMETER_LIMITS.release.min, PARAMETER_LIMITS.release.max, defaults.release),
    makeup: clampNumber(value.makeup, PARAMETER_LIMITS.makeup.min, PARAMETER_LIMITS.makeup.max, defaults.makeup),
  };
}

function eqBands(value: unknown): EqBands {
  const defaults = DEFAULT_TRACK_PARAMETERS.eq;
  if (!isRecord(value)) return { ...defaults };
  return {
    low: clampNumber(value.low, PARAMETER_LIMITS.eqLow.min, PARAMETER_LIMITS.eqLow.max, defaults.low),
    mid: clampNumber(value.mid, PARAMETER_LIMITS.eqMid.min, PARAMETER_LIMITS.eqMid.max, defaults.mid),
    high: clampNumber(value.high, PARAMETER_LIMITS.eqHigh.min, PARAMETER_LIMITS.eqHigh.max, defaults.high),
  };
}

function loopRegion(value: unknown): LoopRegion {
  const defaults = DEFAULT_TRACK_PARAMETERS.loop;
  if (!isRecord(value)) return { ...defaults };
  const start = clampNumber(value.start, PARAMETER_LIMITS.loopTime.min, PARAMETER_LIMITS.loopTime.max, defaults.start);
  const end = clampNumber(value.end, PARAMETER_LIMITS.loopTime.min, PARAMETER_LIMITS.loopTime.max, defaults.end);
  return { on: bool(value.on, defaults.on), start, end: end > start ? end : 0 };
}

/** Whatever came in becomes a full parameter set; nothing is left half-read. */
export function sanitizeTrackParameters(value: unknown): TrackParameters {
  if (!isRecord(value)) return { ...DEFAULT_TRACK_PARAMETERS, eq: { ...DEFAULT_TRACK_PARAMETERS.eq }, compressor: { ...DEFAULT_TRACK_PARAMETERS.compressor }, loop: { ...DEFAULT_TRACK_PARAMETERS.loop } };
  const defaults = DEFAULT_TRACK_PARAMETERS;
  return {
    rate: clampNumber(value.rate, PARAMETER_LIMITS.rate.min, PARAMETER_LIMITS.rate.max, defaults.rate),
    preservePitch: bool(value.preservePitch, defaults.preservePitch),
    volume: clampNumber(value.volume, PARAMETER_LIMITS.volume.min, PARAMETER_LIMITS.volume.max, defaults.volume),
    gain: clampNumber(value.gain, PARAMETER_LIMITS.gain.min, PARAMETER_LIMITS.gain.max, defaults.gain),
    eq: eqBands(value.eq),
    pan: clampNumber(value.pan, PARAMETER_LIMITS.pan.min, PARAMETER_LIMITS.pan.max, defaults.pan),
    compressor: compressor(value.compressor),
    fadeIn: clampNumber(value.fadeIn, PARAMETER_LIMITS.fade.min, PARAMETER_LIMITS.fade.max, defaults.fadeIn),
    fadeOut: clampNumber(value.fadeOut, PARAMETER_LIMITS.fade.min, PARAMETER_LIMITS.fade.max, defaults.fadeOut),
    loop: loopRegion(value.loop),
  };
}

/**
 * The stored form: a real record becomes a sanitized document, anything else is "this asset has
 * no saved parameters" — which is what a legacy metadata blob without the field must mean.
 */
export function storedParameters(value: unknown): TrackParameters | undefined {
  return isRecord(value) ? sanitizeTrackParameters(value) : undefined;
}

export function sanitizeWaveformSettings(value: unknown): WaveformSettings {
  const defaults = DEFAULT_WAVEFORM_SETTINGS;
  if (!isRecord(value)) return { ...defaults };
  return {
    amplitude: clampNumber(value.amplitude, PARAMETER_LIMITS.amplitude.min, PARAMETER_LIMITS.amplitude.max, defaults.amplitude),
    smoothing: clampNumber(value.smoothing, PARAMETER_LIMITS.smoothing.min, PARAMETER_LIMITS.smoothing.max, defaults.smoothing),
    resolution: Math.round(clampNumber(value.resolution, PARAMETER_LIMITS.resolution.min, PARAMETER_LIMITS.resolution.max, defaults.resolution)),
    gap: clampNumber(value.gap, PARAMETER_LIMITS.gap.min, PARAMETER_LIMITS.gap.max, defaults.gap),
    mirror: bool(value.mirror, defaults.mirror),
    grid: bool(value.grid, defaults.grid),
    playhead: bool(value.playhead, defaults.playhead),
    zoom: clampNumber(value.zoom, PARAMETER_LIMITS.zoom.min, PARAMETER_LIMITS.zoom.max, defaults.zoom),
    scroll: clamp01(value.scroll, defaults.scroll),
  };
}
