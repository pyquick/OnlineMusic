/**
 * The sound-shaping parameters of one track and the display settings of its waveform — the shape
 * the editor writes, the API stores and the audio graph applies.
 *
 * They live in shared/ for the same reason the lyrics document does: three layers speak them.
 * The page holds them, the parameter editor edits them, and the server validates them on the way
 * into an asset's metadata, so a document written by an older client is read back by the same
 * rules everywhere instead of drifting per surface.
 *
 * Every unit is chosen for the wire, not for the control: percentages are whole numbers, EQ gains
 * are decibels and times are seconds, so a stored document reads like the dials it came from.
 */

export interface EqBands {
  /** Low shelf, dB. */
  low: number;
  /** Mid peaking band, dB. */
  mid: number;
  /** High shelf, dB. */
  high: number;
}

export interface CompressorParameters {
  on: boolean;
  /** dB, -60..0. */
  threshold: number;
  /** 1..20. */
  ratio: number;
  /** Seconds, 0..1. */
  attack: number;
  /** Seconds, 0..1. */
  release: number;
  /** Percent of make-up gain, 0..200. */
  makeup: number;
}

/** An A/B loop: `end` of 0 means "the end of the track", so a loop keeps working on another song. */
export interface LoopRegion {
  on: boolean;
  start: number;
  end: number;
}

export interface TrackParameters {
  /** Playback speed, percent, 50..200. */
  rate: number;
  /** Keep the pitch while the rate changes. */
  preservePitch: boolean;
  /** Output level, percent, 0..150 — the level the transport bar's speaker shares. */
  volume: number;
  /** Pre-amp into the effect chain, percent, 0..200. */
  gain: number;
  eq: EqBands;
  /** Stereo position, -100 (left) .. 100 (right). */
  pan: number;
  compressor: CompressorParameters;
  /** Seconds, 0..30. */
  fadeIn: number;
  /** Seconds, 0..30. */
  fadeOut: number;
  loop: LoopRegion;
}

/**
 * How the waveform is drawn. These are a viewing preference rather than a property of the track,
 * so they persist with the other local settings instead of in the asset's metadata.
 */
export interface WaveformSettings {
  /** Vertical gain, percent, 50..300. */
  amplitude: number;
  /** Peak-to-RMS blend, percent: 0 draws peaks, 100 draws the average body. */
  smoothing: number;
  /** Bars drawn across the viewport, 48..1024. */
  resolution: number;
  /** Gap between bars, percent of a bar's width, 0..80. */
  gap: number;
  /** Draw the negative half below the centre line rather than a single row. */
  mirror: boolean;
  /** Time ticks above the waveform. */
  grid: boolean;
  /** Show the playhead. */
  playhead: boolean;
  /** Horizontal zoom, 1..32 (1 shows the whole track). */
  zoom: number;
  /** Centre of the visible window while zoomed, 0..1. */
  scroll: number;
}

/** One preset's sound-shaping patch: the fields a preset is allowed to move and nothing else. */
export interface ParameterPatch {
  gain?: number;
  eq?: Partial<EqBands>;
  pan?: number;
  compressor?: Partial<CompressorParameters>;
}

/**
 * The numbers a control may produce, single-sourced so the slider, the typed field and the
 * validator cannot disagree about what is legal.
 */
export const PARAMETER_LIMITS = {
  rate: { min: 50, max: 200, step: 1 },
  volume: { min: 0, max: 100, step: 1 },
  gain: { min: 0, max: 200, step: 1 },
  eqLow: { min: -12, max: 12, step: 0.5 },
  eqMid: { min: -12, max: 12, step: 0.5 },
  eqHigh: { min: -12, max: 12, step: 0.5 },
  pan: { min: -100, max: 100, step: 1 },
  threshold: { min: -60, max: 0, step: 1 },
  ratio: { min: 1, max: 20, step: 0.5 },
  attack: { min: 0, max: 1, step: 0.005 },
  release: { min: 0, max: 1, step: 0.01 },
  makeup: { min: 0, max: 200, step: 1 },
  fade: { min: 0, max: 30, step: 0.1 },
  loopTime: { min: 0, max: 36_000, step: 0.01 },
  amplitude: { min: 50, max: 300, step: 5 },
  smoothing: { min: 0, max: 100, step: 1 },
  resolution: { min: 48, max: 1024, step: 8 },
  gap: { min: 0, max: 80, step: 1 },
  zoom: { min: 1, max: 32, step: 1 },
  scroll: { min: 0, max: 1, step: 0.001 },
} as const;

export const DEFAULT_TRACK_PARAMETERS: TrackParameters = {
  rate: 100,
  preservePitch: true,
  volume: 72,
  gain: 100,
  eq: { low: 0, mid: 0, high: 0 },
  pan: 0,
  compressor: { on: false, threshold: -24, ratio: 3, attack: 0.01, release: 0.25, makeup: 100 },
  fadeIn: 0,
  fadeOut: 0,
  loop: { on: false, start: 0, end: 0 },
};

export const DEFAULT_WAVEFORM_SETTINGS: WaveformSettings = {
  amplitude: 100,
  smoothing: 20,
  resolution: 220,
  gap: 30,
  mirror: false,
  grid: true,
  playhead: true,
  zoom: 1,
  scroll: 0.5,
};

/** Applies a patch over a parameter set, keeping everything the patch does not name. */
export function patchParameters(params: TrackParameters, patch: ParameterPatch): TrackParameters {
  return {
    ...params,
    gain: patch.gain === undefined ? params.gain : patch.gain,
    pan: patch.pan === undefined ? params.pan : patch.pan,
    eq: { ...params.eq, ...patch.eq },
    compressor: { ...params.compressor, ...patch.compressor },
  };
}

/** Structural equality, for the editor's "unsaved changes" light. */
export function parametersEqual(left: TrackParameters, right: TrackParameters): boolean {
  return left.rate === right.rate
    && left.preservePitch === right.preservePitch
    && left.volume === right.volume
    && left.gain === right.gain
    && left.pan === right.pan
    && left.eq.low === right.eq.low
    && left.eq.mid === right.eq.mid
    && left.eq.high === right.eq.high
    && left.compressor.on === right.compressor.on
    && left.compressor.threshold === right.compressor.threshold
    && left.compressor.ratio === right.compressor.ratio
    && left.compressor.attack === right.compressor.attack
    && left.compressor.release === right.compressor.release
    && left.compressor.makeup === right.compressor.makeup
    && left.fadeIn === right.fadeIn
    && left.fadeOut === right.fadeOut
    && left.loop.on === right.loop.on
    && left.loop.start === right.loop.start
    && left.loop.end === right.loop.end;
}
