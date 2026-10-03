/**
 * The session blob's contracts: what a refresh restores, and that a hand-edited or stale blob
 * cannot smuggle anything else in. Pure data, so Node's runner reads it directly.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readStoredSession, SESSION_VIEWS } from "../shared/utilities/settings.ts";

describe("readStoredSession", () => {
  test("an unusable value restores nothing", () => {
    for (const input of [null, undefined, 42, "session", true]) {
      assert.equal(readStoredSession(input), null);
    }
  });

  test("a blob missing fields restores the safe default of each", () => {
    assert.deepEqual(readStoredSession({}), {
      view: "studio", track: null, time: 0, playing: false, playOrder: [], nowOpen: false,
    });
  });

  test("an unknown view falls back to the studio", () => {
    assert.equal(readStoredSession({ view: "nowhere" }).view, "studio");
    for (const view of SESSION_VIEWS) assert.equal(readStoredSession({ view }).view, view);
  });

  test("time is a finite, non-negative number", () => {
    assert.equal(readStoredSession({ time: 42.5 }).time, 42.5);
    assert.equal(readStoredSession({ time: -3 }).time, 0);
    assert.equal(readStoredSession({ time: Number.NaN }).time, 0);
    assert.equal(readStoredSession({ time: Number.POSITIVE_INFINITY }).time, 0);
    assert.equal(readStoredSession({ time: "12" }).time, 0);
  });

  test("booleans are strict and the order holds strings only", () => {
    assert.equal(readStoredSession({ playing: 1 }).playing, false);
    assert.equal(readStoredSession({ nowOpen: "yes" }).nowOpen, false);
    assert.equal(readStoredSession({ nowOpen: true }).nowOpen, true);
    assert.deepEqual(readStoredSession({ playOrder: ["a", 2, null, "b", ""] }).playOrder, ["a", "b"]);
    assert.deepEqual(readStoredSession({ playOrder: "a" }).playOrder, []);
  });

  test("a track name must be a non-empty string", () => {
    assert.equal(readStoredSession({ track: "song.mp3" }).track, "song.mp3");
    assert.equal(readStoredSession({ track: "" }).track, null);
    assert.equal(readStoredSession({ track: 7 }).track, null);
  });

  test("what was written reads back as the same session", () => {
    const session = { view: "library", track: "a.mp3", time: 61.25, playing: true, playOrder: ["a.mp3", "b.mp3"], nowOpen: true };
    assert.deepEqual(readStoredSession(JSON.parse(JSON.stringify(session))), session);
  });
});
