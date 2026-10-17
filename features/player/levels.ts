/**
 * The envelope and the meter — the two pieces of arithmetic the audio graph, the waveform and
 * their tests share, kept pure so none of them has to own a copy.
 */

/**
 * How much of the output survives at `time`: the fade-in ramp, the fade-out ramp, or one.
 *
 * The two fades multiply rather than replace each other, so a very short take with a long fade on
 * each end melts into silence at its middle instead of letting one ramp win.
 */
export function fadeGainAt(time: number, duration: number, fadeIn: number, fadeOut: number): number {
  if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return 1;
  let gain = 1;
  if (fadeIn > 0 && time < fadeIn) gain = Math.min(gain, Math.max(0, time) / fadeIn);
  if (fadeOut > 0 && time > duration - fadeOut) gain = Math.min(gain, Math.max(0, duration - time) / fadeOut);
  return Math.max(0, Math.min(1, gain));
}

/** The peak and RMS of one time-domain window, both 0..1 — what a level meter shows. */
export function meterOf(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    const magnitude = value < 0 ? -value : value;
    if (magnitude > peak) peak = magnitude;
    sum += value * value;
  }
  return { peak, rms: samples.length ? Math.sqrt(sum / samples.length) : 0 };
}
