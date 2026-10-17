"use client";

import { useEffect, useState } from "react";

/**
 * The real waveform behind a track: the file is decoded once, at a sampling rate far below the
 * one it plays at, then folded into fixed buckets of {min, max, rms}.
 *
 * The buckets are the contract. A canvas may ask for 48 bars or 1024, the whole track or a
 * sixteenth of it, and every request is answered from the same array — so zooming never decodes
 * again, and two surfaces showing one track cannot disagree about its shape.
 *
 * Decoding is deliberately lazy and fallible. A browser without Web Audio, a file `fetch` is not
 * allowed to read, or a codec the platform refuses all end as `null`, and the caller keeps its
 * decorative fallback instead of showing an error over a player that works.
 */

export type WaveformPeak = {
  /** The most negative sample in the bucket, −1..0. */
  min: number;
  /** The most positive sample in the bucket, 0..1. */
  max: number;
  /** The bucket's energy, 0..1. Peaks stay sharp at 0, the body carries at 100. */
  rms: number;
};

export type WaveformPeaks = {
  /** Fixed-resolution buckets across the whole track. */
  peaks: WaveformPeak[];
  /** The loudest sample in the file, 0..1 — what a display has to lift for a quiet take. */
  peak: number;
  /** Seconds. */
  duration: number;
};

/** Enough detail for a 1024-bar view, with spare buckets to read while zoomed in. */
export const PEAK_BUCKETS = 2048;

/**
 * An 8 kHz envelope is indistinguishable from a 44.1 kHz one at any bar count a screen can show,
 * and keeping roughly a fifth of the samples makes decoding a file cheap.
 */
export const DECODE_RATE = 8000;

/**
 * Folds sample data into buckets. Pure on purpose: the tests hand it synthetic channels, and the
 * hook hands it whatever the decoder produced.
 */
export function computePeaks(channels: Float32Array[], buckets: number): { peaks: WaveformPeak[]; peak: number } {
  const length = channels.length > 0 ? channels[0].length : 0;
  const count = Math.max(1, Math.floor(buckets));
  const peaks: WaveformPeak[] = [];
  let overall = 0;
  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index * length) / count);
    const end = Math.max(start + 1, Math.floor(((index + 1) * length) / count));
    let min = 0;
    let max = 0;
    let sum = 0;
    let samples = 0;
    for (let channel = 0; channel < channels.length; channel += 1) {
      const data = channels[channel];
      for (let at = start; at < end && at < length; at += 1) {
        const value = data[at];
        if (value < min) min = value;
        if (value > max) max = value;
        sum += value * value;
        samples += 1;
      }
    }
    if (max > overall) overall = max;
    if (-min > overall) overall = -min;
    peaks.push({ min, max, rms: samples ? Math.sqrt(sum / samples) : 0 });
  }
  return { peaks, peak: overall };
}

type OfflineCtor = typeof OfflineAudioContext;

function offlineCtor(): OfflineCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const legacy = window as unknown as { webkitOfflineAudioContext?: OfflineCtor };
  return window.OfflineAudioContext ?? legacy.webkitOfflineAudioContext;
}

async function decode(url: string): Promise<WaveformPeaks | null> {
  const Ctor = offlineCtor();
  if (!Ctor) return null;
  let bytes: ArrayBuffer;
  try {
    // Credentials ride along even cross-origin: the desktop shell serves its pages from
    // app://bundle and reads the API on another origin, and the file route allows that origin.
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) return null;
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }
  let buffer: AudioBuffer;
  try {
    // A one-frame context is just a decoder tuned to DECODE_RATE: no rendering ever happens here,
    // and `decodeAudioData` resamples the file down to the context's own rate for us.
    const context = new Ctor(1, 1, DECODE_RATE);
    buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      // The callback form is the one Safari has always had; the promise form is what the spec
      // added later. Passing both keeps every engine on the same path.
      context.decodeAudioData(bytes, resolve, reject);
    });
  } catch {
    return null;
  }
  const channels: Float32Array[] = [];
  for (let index = 0; index < Math.min(2, buffer.numberOfChannels); index += 1) channels.push(buffer.getChannelData(index));
  if (channels.length === 0) return null;
  const { peaks, peak } = computePeaks(channels, PEAK_BUCKETS);
  return { peaks, peak, duration: buffer.duration };
}

/** One decode per URL per session. A failed decode is forgotten, so a later attempt may win. */
const decodes = new Map<string, Promise<WaveformPeaks | null>>();

function decodeOnce(url: string): Promise<WaveformPeaks | null> {
  const running = decodes.get(url);
  if (running) return running;
  const job = decode(url).then((result) => {
    if (!result) decodes.delete(url);
    return result;
  }, () => {
    decodes.delete(url);
    return null;
  });
  decodes.set(url, job);
  return job;
}

/**
 * The track's shape, or `null` while it is being decoded and whenever it cannot be had. Callers
 * pass it to the waveform, which falls back to its decorative bars on `null`.
 */
export function useWaveformPeaks(url: string | null | undefined): WaveformPeaks | null {
  const [data, setData] = useState<WaveformPeaks | null>(null);
  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    let live = true;
    setData(null);
    void decodeOnce(url).then((result) => {
      if (live) setData(result);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return data;
}
