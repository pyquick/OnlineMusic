/**
 * The glass model's contracts, on Node's own runner.
 *
 * These pin the things a refactor or a settings-shape change could silently break for someone
 * who already has a blob in their browser: the field names and order the studio writes, the
 * clamps that keep a slider from being driven past its ceiling, and the two historical band
 * formats a saved blob can be in.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_GLASS_SETTINGS, glassStoredFields, readGlassSettings,
} from "../features/glass/model.ts";

describe("readGlassSettings", () => {
  test("unusable input falls back to the defaults", () => {
    for (const input of [null, undefined, 42, "glass", true]) {
      assert.deepEqual(readGlassSettings(input), DEFAULT_GLASS_SETTINGS);
    }
  });

  test("a partial blob keeps the defaults for everything it omits", () => {
    const settings = readGlassSettings({ glassBlur: 20 });
    assert.equal(settings.blur, 20);
    assert.equal(settings.radius, DEFAULT_GLASS_SETTINGS.radius);
    assert.equal(settings.refraction, DEFAULT_GLASS_SETTINGS.refraction);
    assert.deepEqual(settings.groups, {});
    assert.equal(settings.webgl, false);
  });

  test("the WebGL switch is strictly boolean", () => {
    assert.equal(readGlassSettings({ glassWebgl: true }).webgl, true);
    for (const stray of [1, 0, "true", {}, []]) {
      assert.equal(readGlassSettings({ glassWebgl: stray }).webgl, false);
    }
  });

  test("every dial is clamped to its slider's range", () => {
    const high = readGlassSettings({ glassBlur: 100, glassRadius: 999, glassClarity: 150, glassEdge: 999, glassBandPx: 999, glassDispersion: 150 });
    assert.equal(high.blur, 30);
    assert.equal(high.radius, 150);
    assert.equal(high.clarity, 100);
    assert.equal(high.edge, 84);
    assert.equal(high.refraction, 84);
    assert.equal(high.dispersion, 100);
    const low = readGlassSettings({ glassBlur: -5, glassRadius: 10, glassClarity: -3, glassEdge: -9, glassBandPx: -9, glassDispersion: -3 });
    assert.equal(low.blur, 0);
    assert.equal(low.radius, 50);
    assert.equal(low.clarity, 0);
    assert.equal(low.edge, 0);
    assert.equal(low.refraction, 0);
    assert.equal(low.dispersion, 0);
  });

  test("a band saved as a percent of the short side is scaled to px", () => {
    assert.equal(readGlassSettings({ glassRefraction: 12 }).refraction, 30);
    assert.equal(readGlassSettings({ glassRefraction: 33.6 }).refraction, 84);
  });

  test("a px band wins over the legacy percent, and only the stored width is rounded", () => {
    assert.equal(readGlassSettings({ glassBandPx: 84, glassRefraction: 1 }).refraction, 84);
    assert.equal(readGlassSettings({ glassBandPx: 20.4 }).refraction, 20);
    assert.equal(readGlassSettings({ glassRefraction: 11.9 }).refraction, 30);
  });

  test("family overrides are clamped, and a family the build does not know is dropped", () => {
    const settings = readGlassSettings({
      glassGroups: {
        card: { band: 200.4, pull: -3 },
        chip: { band: 12 },
        bogus: { band: 10, pull: 10 },
      },
    });
    assert.deepEqual(Object.keys(settings.groups), ["card"]);
    assert.equal(settings.groups.card.band, 84);
    assert.equal(settings.groups.card.pull, 0);
  });
});

describe("glassStoredFields", () => {
  test("writes the historical field names, in the stored order", () => {
    const fields = glassStoredFields(DEFAULT_GLASS_SETTINGS);
    assert.deepEqual(Object.keys(fields), [
      "glassBlur", "glassRadius", "glassClarity", "glassEdge", "glassBandPx", "glassDispersion", "glassGroups", "glassWebgl",
    ]);
  });

  test("what was written reads back as the same dials", () => {
    const settings = readGlassSettings({ glassBlur: 7.4, glassRadius: 120, glassClarity: 44, glassEdge: 21, glassBandPx: 63, glassDispersion: 12, glassGroups: { pane: { band: 40, pull: 16 } }, glassWebgl: true });
    assert.deepEqual(readGlassSettings(glassStoredFields(settings)), settings);
  });
});
