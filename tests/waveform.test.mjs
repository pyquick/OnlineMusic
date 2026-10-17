/**
 * The waveform's own arithmetic: the buckets a track is folded into, the fade curve the graph
 * applies, and the meter it reads back. All three are pure, which is why they can be pinned here
 * without a browser, an audio file or an AudioContext.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computePeaks } from "../features/player/peaks.ts";
import { fadeGainAt, meterOf } from "../features/player/levels.ts";

describe("computePeaks", () => {
  test("folds each bucket to its min, max and RMS", () => {
    const channel = Float32Array.from([1, -1, 0.5, -0.5]);
    const { peaks, peak } = computePeaks([channel], 2);
    assert.equal(peaks.length, 2);
    assert.deepEqual(peaks[0], { min: -1, max: 1, rms: 1 });
    assert.equal(peaks[1].min, -0.5);
    assert.equal(peaks[1].max, 0.5);
    assert.ok(Math.abs(peaks[1].rms - 0.5) < 1e-6);
    assert.equal(peak, 1);
  });

  test("reads every channel, so a hard-panned sample is not missed", () => {
    const left = Float32Array.from([0.2, 0.2, 0.2, 0.2]);
    const right = Float32Array.from([0.9, 0.9, 0.9, 0.9]);
    const { peaks, peak } = computePeaks([left, right], 1);
    assert.equal(peaks.length, 1);
    // Float32 rounds 0.9 down, so the reading is compared with a tolerance rather than by name.
    assert.ok(Math.abs(peaks[0].max - 0.9) < 1e-6);
    assert.ok(Math.abs(peak - 0.9) < 1e-6);
  });

  test("an empty channel still answers with a full set of quiet buckets", () => {
    const { peaks, peak } = computePeaks([new Float32Array(0)], 4);
    assert.equal(peaks.length, 4);
    assert.equal(peak, 0);
    for (const bucket of peaks) assert.deepEqual(bucket, { min: 0, max: 0, rms: 0 });
  });
});

describe("fadeGainAt", () => {
  test("no fades means no attenuation anywhere", () => {
    for (const time of [0, 1, 30, 240]) assert.equal(fadeGainAt(time, 240, 0, 0), 1);
  });

  test("the fade-in ramps from silence to full", () => {
    assert.equal(fadeGainAt(0, 100, 4, 0), 0);
    assert.equal(fadeGainAt(2, 100, 4, 0), 0.5);
    assert.equal(fadeGainAt(4, 100, 4, 0), 1);
    assert.equal(fadeGainAt(50, 100, 4, 0), 1);
  });

  test("the fade-out ramps back down, and the two multiply when they overlap", () => {
    assert.equal(fadeGainAt(95, 100, 0, 10), 0.5);
    assert.equal(fadeGainAt(100, 100, 0, 10), 0);
    assert.equal(fadeGainAt(5, 10, 8, 8), 0.625);
  });

  test("a duration that is not there yet leaves the output alone", () => {
    assert.equal(fadeGainAt(1, 0, 4, 4), 1);
    assert.equal(fadeGainAt(Number.NaN, 100, 4, 4), 1);
  });
});

describe("meterOf", () => {
  test("peak and RMS of a known window", () => {
    const reading = meterOf(Float32Array.from([0.5, -0.5, 0.5, -0.5]));
    assert.equal(reading.peak, 0.5);
    assert.ok(Math.abs(reading.rms - 0.5) < 1e-6);
  });

  test("silence reads as silence", () => {
    assert.deepEqual(meterOf(new Float32Array(8)), { peak: 0, rms: 0 });
  });
});
