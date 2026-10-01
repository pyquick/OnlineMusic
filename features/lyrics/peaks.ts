/**
 * The editor's waveform is real: the asset's own file is fetched, decoded once and reduced to a
 * peak envelope, then remembered for the session. A file too long to decode comfortably is left
 * without a waveform rather than given a fake one — a synthetic drawing under a timing ruler
 * would be a lie the user times against.
 */
const cache = new Map<string, Promise<Float32Array | null>>();
/** Decoded audio is held as float samples while decoding; past this estimate we step aside. */
const MAX_DECODED_BYTES = 260_000_000;
export const PEAK_BUCKETS = 2400;

export function loadPeaks(url: string, durationSeconds: number): Promise<Float32Array | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  const task = compute(url, durationSeconds).catch(() => null);
  cache.set(url, task);
  return task;
}

async function compute(url: string, durationSeconds: number): Promise<Float32Array | null> {
  if (durationSeconds > 0 && durationSeconds * 44_100 * 2 * 4 > MAX_DECODED_BYTES) return null;
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) return null;
  const buffer = await response.arrayBuffer();
  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return null;
  const context = new AudioCtor();
  try {
    const audio = await context.decodeAudioData(buffer);
    return envelope(audio);
  } finally {
    void context.close().catch(() => undefined);
  }
}

function envelope(audio: AudioBuffer): Float32Array {
  const data = audio.getChannelData(0);
  const length = data.length;
  const buckets = Math.min(PEAK_BUCKETS, Math.max(1, length));
  const step = length / buckets;
  const peaks = new Float32Array(buckets);
  let loudest = 0;
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const from = Math.floor(bucket * step);
    const to = Math.min(length, Math.max(from + 1, Math.floor((bucket + 1) * step)));
    // A stride keeps the scan bounded on long files; music has no single-sample spikes that matter.
    const stride = Math.max(1, Math.floor((to - from) / 64));
    let peak = 0;
    for (let index = from; index < to; index += stride) {
      const value = data[index] < 0 ? -data[index] : data[index];
      if (value > peak) peak = value;
    }
    peaks[bucket] = peak;
    if (peak > loudest) loudest = peak;
  }
  if (loudest > 0) {
    for (let bucket = 0; bucket < buckets; bucket += 1) peaks[bucket] /= loudest;
  }
  return peaks;
}
