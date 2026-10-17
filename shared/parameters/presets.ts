import { patchParameters, type ParameterPatch, type TrackParameters } from "./types";

/**
 * The starting points a listener actually reaches for: a clean slate, a vocal that sits forward,
 * a low end that carries, a loudness curve for a phone speaker and a night curve that keeps quiet
 * passages legible. A preset only moves tone and dynamics — never the rate, the fades or the loop
 * region, which belong to the take rather than to the taste.
 */

export type ParameterPreset = {
  id: string;
  name: string;
  hint: string;
  patch: ParameterPatch;
};

export const PARAMETER_PRESETS: ParameterPreset[] = [
  {
    id: "flat",
    name: "Flat",
    hint: "Everything back to zero — the file as it was mastered.",
    patch: { gain: 100, eq: { low: 0, mid: 0, high: 0 }, pan: 0, compressor: { on: false, threshold: -24, ratio: 3, attack: 0.01, release: 0.25, makeup: 100 } },
  },
  {
    id: "vocal",
    name: "Vocal",
    hint: "Lifts the mid band and tames peaks so the words stay on top.",
    patch: {
      gain: 105,
      eq: { low: -3, mid: 2.5, high: 2 },
      compressor: { on: true, threshold: -24, ratio: 3, attack: 0.008, release: 0.22, makeup: 115 },
    },
  },
  {
    id: "bass",
    name: "Low end",
    hint: "A low shelf with a gentle knee, for small speakers and quiet rooms.",
    patch: {
      gain: 100,
      eq: { low: 6, mid: -1.5, high: 0.5 },
      compressor: { on: true, threshold: -20, ratio: 2.5, attack: 0.01, release: 0.3, makeup: 105 },
    },
  },
  {
    id: "loudness",
    name: "Loudness",
    hint: "A firm compressor and a little make-up gain — the phone-speaker curve.",
    patch: {
      gain: 110,
      eq: { low: 2, mid: 0, high: 1.5 },
      compressor: { on: true, threshold: -30, ratio: 4, attack: 0.005, release: 0.18, makeup: 135 },
    },
  },
  {
    id: "night",
    name: "Night",
    hint: "Heavy control, softened top — late listening without the jumps.",
    patch: {
      gain: 100,
      eq: { low: -4, mid: 1, high: -1 },
      compressor: { on: true, threshold: -38, ratio: 6, attack: 0.004, release: 0.35, makeup: 165 },
    },
  },
];

/** The preset's patch laid over the current parameters, leaving everything else untouched. */
export function applyPreset(params: TrackParameters, preset: ParameterPreset): TrackParameters {
  return patchParameters(params, preset.patch);
}
