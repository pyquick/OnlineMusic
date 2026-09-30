/**
 * The studio's unit tests, on Node's own runner: `node --test tests/`.
 *
 * No framework, on purpose. Everything under test here is a pure function that was already in a
 * module of its own, and the value of pinning it is in the *contracts* rather than the coverage:
 * the time format the transport prints, the artwork rule a card follows, the validation the API
 * enforces before a file lands on disk.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatTime } from "../shared/utilities/time.ts";
import { coverSrc } from "../shared/utilities/media.ts";
import { hexLuma, hexToRgb, rgbToHex, tintChannels, DEFAULT_APPEARANCE } from "../features/appearance/model.ts";
import { validateCreateInput, validateMetadata, AssetValidationError } from "../lib/asset-validation.ts";

describe("formatTime", () => {
  test("prints m:ss, padding the seconds", () => {
    assert.equal(formatTime(0), "0:00");
    assert.equal(formatTime(9), "0:09");
    assert.equal(formatTime(61), "1:01");
    assert.equal(formatTime(600), "10:00");
  });
  test("anything unusable reads as zero rather than NaN", () => {
    for (const value of [NaN, Infinity, -1]) assert.equal(formatTime(value), "0:00");
  });
});

describe("coverSrc", () => {
  test("an inline cover wins over a URL", () => {
    assert.equal(coverSrc({ metadata: { coverData: "data:image/png;base64,AA", coverUrl: "/api/x/cover" } }), "data:image/png;base64,AA");
  });
  test("a missing or non-string cover is empty, never undefined", () => {
    assert.equal(coverSrc({ metadata: {} }), "");
    assert.equal(coverSrc({ metadata: { coverData: 42 } }), "");
  });
});

describe("the appearance model", () => {
  test("tint channels survive a malformed string", () => {
    assert.deepEqual(tintChannels(""), [255, 255, 255]);          // blank is absent, not black
    assert.deepEqual(tintChannels("10 20 30"), [10, 20, 30]);
    assert.deepEqual(tintChannels("10 nope"), [10, 255, 255]);
  });
  test("hex and channels round-trip", () => {
    assert.equal(rgbToHex("229 72 77"), "#e5484d");
    assert.equal(hexToRgb("#e5484d"), "229 72 77");
    assert.equal(hexToRgb("#fff"), "255 255 255");
    assert.equal(hexToRgb("nonsense"), "255 255 255");
  });
  test("luma is the weighting the ink sampler uses", () => {
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
    near(hexLuma("#000000"), 0);
    near(hexLuma("#ffffff"), 1);          // the weights sum to 1 in exact maths, not in doubles
    near(hexLuma("#808080"), 0.50196);
  });
  test("the defaults are the paper studio the app has always opened on", () => {
    assert.equal(DEFAULT_APPEARANCE.bgKind, "gradient");
    assert.equal(DEFAULT_APPEARANCE.shellLuma, 0.96);
    assert.equal(DEFAULT_APPEARANCE.tint, "255 255 255");
  });
});

describe("asset validation", () => {
  const base = { name: "song.wav", mediaKind: "audio", format: "wav" };

  test("accepts what the import dialog actually sends", () => {
    const input = validateCreateInput({ ...base, metadata: { title: "Song", artist: "Someone", sizeBytes: 123, mimeType: "audio/wav" } });
    assert.equal(input.name, "song.wav");
    assert.equal(input.metadata.title, "Song");
    assert.equal(input.metadata.sizeBytes, 123);
  });

  test("accepts every format the dialog offers, or the UI promises what the API refuses", () => {
    for (const format of ["wav", "mp3", "flac", "aiff", "m4a", "ogg", "oga", "opus", "aac", "wma"]) {
      assert.equal(validateCreateInput({ ...base, format }).format, format);
    }
    for (const format of ["mp4", "mov", "webm", "mkv", "avi"]) {
      assert.equal(validateCreateInput({ ...base, mediaKind: "video", format }).format, format);
    }
  });

  test("refuses what it is there to refuse", () => {
    assert.throws(() => validateCreateInput({ ...base, name: "n".repeat(201) }), AssetValidationError);
    assert.throws(() => validateCreateInput({ ...base, mediaKind: "notakind" }), AssetValidationError);
    assert.throws(() => validateCreateInput({ ...base, format: "exe" }), AssetValidationError);
    assert.throws(() => validateMetadata({ tags: Array.from({ length: 51 }, () => "t") }), AssetValidationError);
    assert.throws(() => validateMetadata({ durationMs: -1 }), AssetValidationError);
  });

  test("metadata it does not know about is dropped, not stored", () => {
    const metadata = validateMetadata({ title: "T", somethingElse: "x" });
    assert.equal(metadata.somethingElse, undefined);
  });
});
