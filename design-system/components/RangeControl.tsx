"use client";

/**
 * The studio's one slider: a label, the value as it reads right now, and the range input.
 *
 * It is a primitive rather than a feature component because three unrelated surfaces want
 * exactly this — the five glass dials, the parameter editor's dynamics and the background's
 * dim — and none of them wants to know how a slider is built. The input itself stays native:
 * that is what keeps the arrow keys, the keyboard focus ring and `color-scheme` working, all
 * of which the stylesheet in globals.css already dresses.
 */
export function RangeControl({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step?: number; display: string; onChange: (value: number) => void }) {
  return <label className="range-control"><span>{label}<b>{display}</b></span><input type="range" value={value} min={min} max={max} step={step ?? 1} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
