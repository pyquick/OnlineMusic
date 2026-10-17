import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_TRACK_PARAMETERS,
  DEFAULT_WAVEFORM_SETTINGS,
  PARAMETER_LIMITS,
  PARAMETER_PRESETS,
  applyPreset,
  parametersEqual,
  patchParameters,
  sanitizeTrackParameters,
  sanitizeWaveformSettings,
  storedParameters,
} from "../shared/parameters/index.ts";
import { assetIndexEntry } from "../lib/assets.ts";
import { validateMetadata } from "../lib/asset-validation.ts";
import { computePeaks } from "../features/player/peaks.ts";

/**
 * The parameter document is written by dials, by presets and by older clients, so the checks that
 * matter are the ones about what happens to a number that is missing, out of range or of the
 * wrong type — the mixer must still get something it can apply.
 */

describe("the parameter document", () => {
  test("anything that is not a record reads back as the defaults", () => {
    assert.deepEqual(sanitizeTrackParameters(null), DEFAULT_TRACK_PARAMETERS);
    assert.deepEqual(sanitizeTrackParameters("loud"), DEFAULT_TRACK_PARAMETERS);
    assert.deepEqual(sanitizeTrackParameters([1, 2]), DEFAULT_TRACK_PARAMETERS);
  });

  test("out-of-range dials land on the nearest legal value, not on the default", () => {
    const params = sanitizeTrackParameters({ rate: 999, volume: -40, gain: 500, pan: 400, fadeIn: 120, eq: { low: 40, mid: -30, high: 2 } });
    assert.equal(params.rate, PARAMETER_LIMITS.rate.max);
    assert.equal(params.volume, PARAMETER_LIMITS.volume.min);
    assert.equal(params.gain, PARAMETER_LIMITS.gain.max);
    assert.equal(params.pan, PARAMETER_LIMITS.pan.max);
    assert.equal(params.fadeIn, PARAMETER_LIMITS.fade.max);
    assert.equal(params.eq.low, PARAMETER_LIMITS.eqLow.max);
    assert.equal(params.eq.mid, PARAMETER_LIMITS.eqMid.min);
    assert.equal(params.eq.high, 2);
  });

  test("a half-written document still comes back whole", () => {
    const params = sanitizeTrackParameters({ rate: 120, compressor: { on: true, ratio: 8 } });
    assert.equal(params.rate, 120);
    assert.equal(params.compressor.on, true);
    assert.equal(params.compressor.ratio, 8);
    assert.equal(params.compressor.threshold, DEFAULT_TRACK_PARAMETERS.compressor.threshold);
    assert.equal(params.eq.mid, DEFAULT_TRACK_PARAMETERS.eq.mid);
    assert.equal(params.loop.end, 0);
  });

  test("a loop with its end at or before its start has no end, which means the track's own end", () => {
    assert.equal(sanitizeTrackParameters({ loop: { start: 30, end: 10 } }).loop.end, 0);
    assert.equal(sanitizeTrackParameters({ loop: { start: 30, end: 30 } }).loop.end, 0);
    assert.equal(sanitizeTrackParameters({ loop: { start: 30, end: 45 } }).loop.end, 45);
  });

  test("the stored form only exists when the field is a record", () => {
    assert.equal(storedParameters(undefined), undefined);
    assert.equal(storedParameters("nope"), undefined);
    assert.equal(storedParameters({ rate: 90 })?.rate, 90);
  });
});

describe("presets and patches", () => {
  test("every preset is a legal document when laid over the defaults", () => {
    for (const preset of PARAMETER_PRESETS) {
      const params = applyPreset(DEFAULT_TRACK_PARAMETERS, preset);
      assert.deepEqual(params, sanitizeTrackParameters(params), preset.id);
    }
  });

  test("a preset never moves the take: rate, fades and loop stay where they were", () => {
    const before = sanitizeTrackParameters({ rate: 90, fadeIn: 2, fadeOut: 4, loop: { on: true, start: 10, end: 20 }, preservePitch: false });
    const after = applyPreset(before, PARAMETER_PRESETS.find((preset) => preset.id === "loudness"));
    assert.equal(after.rate, 90);
    assert.equal(after.fadeIn, 2);
    assert.equal(after.fadeOut, 4);
    assert.deepEqual(after.loop, before.loop);
    assert.equal(after.preservePitch, false);
    assert.notEqual(after.compressor.makeup, before.compressor.makeup);
  });

  test("a patch touches only what it names", () => {
    const patched = patchParameters(DEFAULT_TRACK_PARAMETERS, { eq: { high: 3 } });
    assert.equal(patched.eq.high, 3);
    assert.equal(patched.eq.low, DEFAULT_TRACK_PARAMETERS.eq.low);
    assert.equal(patched.gain, DEFAULT_TRACK_PARAMETERS.gain);
  });

  test("equality is structural, so the editor's unsaved light is honest", () => {
    assert.equal(parametersEqual(DEFAULT_TRACK_PARAMETERS, sanitizeTrackParameters(DEFAULT_TRACK_PARAMETERS)), true);
    assert.equal(parametersEqual(DEFAULT_TRACK_PARAMETERS, patchParameters(DEFAULT_TRACK_PARAMETERS, { pan: 5 })), false);
  });
});

describe("the waveform settings", () => {
  test("a missing or broken blob reads as the defaults", () => {
    assert.deepEqual(sanitizeWaveformSettings(undefined), DEFAULT_WAVEFORM_SETTINGS);
    assert.deepEqual(sanitizeWaveformSettings(12), DEFAULT_WAVEFORM_SETTINGS);
  });

  test("zoom and scroll stay inside their rails", () => {
    const settings = sanitizeWaveformSettings({ zoom: 500, scroll: -3, amplitude: 1000, gap: -1 });
    assert.equal(settings.zoom, PARAMETER_LIMITS.zoom.max);
    assert.equal(settings.scroll, PARAMETER_LIMITS.scroll.min);
    assert.equal(settings.amplitude, PARAMETER_LIMITS.amplitude.max);
    assert.equal(settings.gap, PARAMETER_LIMITS.gap.min);
  });
});

describe("parameters on the wire", () => {
  test("metadata validation adopts the document", () => {
    const metadata = validateMetadata({ title: "Take", parameters: { gain: 900, eq: { low: 100 }, loop: { on: true, start: 1, end: 2 } } });
    assert.equal(metadata.parameters.gain, PARAMETER_LIMITS.gain.max);
    assert.equal(metadata.parameters.eq.low, PARAMETER_LIMITS.eqLow.max);
    assert.deepEqual(metadata.parameters.loop, { on: true, start: 1, end: 2 });
  });

  test("metadata without a document has none, and it rides the index when it has one", () => {
    assert.equal(validateMetadata({ title: "Take" }).parameters, undefined);
    const entry = assetIndexEntry({
      id: "1", ownerEmail: "", name: "a.mp3", mediaKind: "audio", format: "mp3", status: "ready",
      metadata: { parameters: { pan: 30 } },
      filePath: "", createdAt: "", updatedAt: "",
    });
    assert.equal(entry.parameters.pan, 30);
    assert.equal(entry.parameters.rate, DEFAULT_TRACK_PARAMETERS.rate);
  });
});

describe("waveform peaks", () => {
  test("a bucket holds the loudest sample of both channels and the average body", () => {
    const left = new Float32Array([0.1, -0.5, 0.2, 0.1, 0.4, -0.2, 0.05, 0.05]);
    const right = new Float32Array([0, 0.5, 0, 0, 0, 0, 0, 0]);
    const { peaks, peak } = computePeaks([left, right], 2);
    assert.equal(peaks.length, 2);
    assert.equal(peaks[0].min, -0.5);
    assert.equal(peaks[0].max, 0.5);
    assert.ok(peaks[0].rms > 0.2 && peaks[0].rms < 0.5);
    // Float32 rounds both of these down, so they are compared with a tolerance rather than by name.
    assert.ok(Math.abs(peaks[1].max - 0.4) < 1e-6);
    assert.ok(Math.abs(peaks[1].min + 0.2) < 1e-6);
    assert.equal(peak, 0.5);
  });

  test("an empty or over-thin request still answers with buckets the canvas can draw", () => {
    const { peaks } = computePeaks([], 4);
    assert.equal(peaks.length, 4);
    assert.deepEqual(peaks[0], { min: 0, max: 0, rms: 0 });
    assert.equal(computePeaks([new Float32Array(8)], 0).peaks.length, 1);
  });
});
