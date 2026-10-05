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
import { assetIndexEntry } from "../lib/assets.ts";
import { parseLyrics, parseLyricsJson, docFromLines } from "../shared/lyrics/parse.ts";
import { toLrc } from "../shared/lyrics/serialize.ts";
import { lineAt, lineEnd, lineState, tokenProgress, tokenFill, docDuration, hasTiming, hasWordTiming } from "../shared/lyrics/timeline.ts";
import { tokenizeText, tokenizeLine } from "../shared/lyrics/tokenizer.ts";
import { parseStamp, stampText } from "../features/lyrics/format.ts";
import {
  addLine, deleteLine, setLineTranslation, setLineSpan, moveLine, tokenizeLineAt, tokenizeAllLines,
  splitLine, mergeLines, shiftAll, earliestTime, setTokenSpan, setTokenText, mergeTokens, moveToken, tokenOffsets,
} from "../shared/lyrics/edit.ts";
import { validateLyricsDoc, coerceLyricsDoc, LyricsValidationError } from "../shared/lyrics/validation.ts";
import { MAX_LYRICS_LINES, MAX_TOKENS_PER_LINE } from "../shared/lyrics/types.ts";

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

describe("lyrics parsing", () => {
  test("LRC stamps become line timing, tags and the offset tag are honoured", () => {
    const doc = parseLyrics("[ar:Someone]\n[offset:+500]\n[00:12.30]Hello world\n[00:15.20][00:20.00]Again\n");
    assert.equal(doc.lines.length, 3);
    assert.equal(doc.lines[0].text, "Hello world");
    assert.equal(doc.lines[0].start, 12.8);          // the offset moves every stamp
    assert.equal(doc.lines[0].end, 15.7);            // a line ends where the next begins
    assert.equal(doc.lines[1].text, "Again");
    assert.equal(doc.lines[1].start, 15.7);
    assert.equal(doc.lines[1].end, 20.5);            // the second stamp on the same row
    assert.equal(doc.lines[2].start, 20.5);
    assert.equal(doc.lines[2].end, undefined);
  });

  test("an empty stamped line is a boundary, not a lyric", () => {
    const doc = parseLyrics("[00:01.00]One\n[00:05.00]\n[00:09.00]Two\n");
    assert.deepEqual(doc.lines.map((line) => line.text), ["One", "Two"]);
    assert.equal(doc.lines[0].end, 5);               // the gap still ends the line before it
    assert.equal(doc.lines[1].start, 9);
  });

  test("enhanced word tags become tokens carrying the stamp they follow", () => {
    const doc = parseLyrics("[00:01.000]<00:01.000>Hel<00:01.500>lo <00:02.000>world<00:02.500>\n");
    const [line] = doc.lines;
    assert.equal(line.text, "Hello world");
    assert.deepEqual(line.tokens.map((token) => token.text), ["Hel", "lo", "world"]);
    assert.deepEqual(line.tokens.map((token) => token.start), [1.5, 2, 2.5]);
    assert.equal(line.tokens[0].end, 2);
    assert.equal(line.end, 2.5);                     // the trailing empty tag names the end
  });

  test("plain text is a document without timing, and never throws on anything", () => {
    const doc = parseLyrics("line one\n\n  line two  \n");
    assert.deepEqual(doc.lines.map((line) => line.text), ["line one", "line two"]);
    assert.equal(hasTiming(doc), false);
    assert.equal(parseLyrics("").lines.length, 0);
    assert.equal(parseLyrics("{ not json").lines.length, 1);   // falls back to a text line
  });

  test("a stored JSON document is read back through the lenient path", () => {
    const doc = parseLyricsJson(JSON.stringify({ version: 1, lines: [{ text: "Hi", start: 1, end: 2, translation: "你好" }] }));
    assert.equal(doc.lines[0].translation, "你好");
    assert.equal(parseLyricsJson("{"), null);
    assert.equal(parseLyricsJson('{"version":9,"lines":[]}'), null);
    assert.equal(docFromLines([]).lines.length, 0);
  });
});

describe("the lyrics timeline", () => {
  const doc = {
    version: 1,
    lines: [
      { text: "One", start: 0, end: 5 },
      { text: "Two", start: 10, tokens: [{ text: "a", start: 10, end: 12 }, { text: "b", start: 12, end: 20 }] },
    ],
  };

  test("the line at a position is the last one that has started", () => {
    assert.equal(lineAt(doc, -1), -1);
    assert.equal(lineAt(doc, 0), 0);
    assert.equal(lineAt(doc, 3), 0);
    assert.equal(lineAt(doc, 7), 0);                 // a gap keeps the last started line
    assert.equal(lineAt(doc, 10), 1);
    assert.equal(lineAt(doc, 999), 1);
  });

  test("past, active and future are read from the effective end", () => {
    assert.equal(lineState(doc, 0, 3), "active");
    assert.equal(lineState(doc, 0, 7), "past");
    assert.equal(lineState(doc, 1, 7), "future");
    assert.equal(lineState(doc, 1, 11), "active");
    assert.equal(lineState(doc, 1, 20), "past");
    assert.equal(lineEnd(doc, 1), 20);               // its last token ends it
    assert.equal(lineEnd(doc, 0), 5);
  });

  test("token progress walks the fill continuously", () => {
    const line = doc.lines[1];
    assert.deepEqual(tokenProgress(line, 9), { index: -1, fill: 0 });
    assert.deepEqual(tokenProgress(line, 11), { index: 0, fill: 0.5 });
    assert.deepEqual(tokenProgress(line, 13), { index: 1, fill: 0.125 });
    assert.deepEqual(tokenProgress(line, 25), { index: 2, fill: 1 });
    assert.deepEqual(tokenProgress({ text: "x", start: 0, end: 1 }, 0.5), { index: -1, fill: 0 });
    assert.equal(docDuration(doc), 20);
  });

  test("untimed tokens take no part in the timeline", () => {
    const line = { text: "a b c", start: 0, end: 6, tokens: [{ text: "a", start: 0, end: 2 }, { text: "b" }, { text: "c", start: 4 }] };
    assert.equal(hasWordTiming(line), true);
    assert.equal(hasWordTiming({ text: "x", tokens: [{ text: "x" }] }), false);
    assert.deepEqual(tokenProgress(line, 1), { index: 0, fill: 0.5 });
    assert.deepEqual(tokenProgress(line, 5), { index: 2, fill: 0 });   // the untimed word neither fills nor blocks
    assert.equal(tokenFill({ text: "x" }, 5), 0);
    const allUntimed = { version: 1, lines: [{ text: "x", start: 0, tokens: [{ text: "x" }] }] };
    assert.equal(lineEnd(allUntimed, 0), Number.POSITIVE_INFINITY);    // nothing timed ends it
    assert.equal(docDuration({ version: 1, lines: [{ text: "x", tokens: [{ text: "x" }] }] }), 0);
  });
});

describe("the tokenizer", () => {
  test("CJK splits per character, Latin per word, punctuation rides what it closes", () => {
    assert.deepEqual(tokenizeText("I love you"), ["I", "love", "you"]);
    assert.deepEqual(tokenizeText("你好，世界"), ["你", "好，", "世", "界"]);
    assert.deepEqual(tokenizeText("Hello, world!"), ["Hello,", "world!"]);
    assert.deepEqual(tokenizeText("(hello)"), ["(hello)"]);
    assert.deepEqual(tokenizeText(""), []);
  });

  test("a line's span is spread over its tokens exactly", () => {
    const tokens = tokenizeLine("I love you", 12.3, 15.2);
    assert.equal(tokens[0].start, 12.3);
    assert.equal(tokens[tokens.length - 1].end, 15.2);
    for (let index = 1; index < tokens.length; index += 1) assert.ok(tokens[index].start >= tokens[index - 1].end - 1e-9);
  });

  test("without a span the words are still cut, they simply carry no times", () => {
    const tokens = tokenizeLine("你好，世界 hello world");
    assert.deepEqual(tokens.map((token) => token.text), ["你", "好，", "世", "界", "hello", "world"]);
    for (const token of tokens) {
      assert.equal(token.start, undefined);
      assert.equal(token.end, undefined);
    }
    assert.equal(tokenizeLine("", undefined, undefined).length, 0);
  });
});

describe("lyrics editing", () => {
  const timed = { version: 1, lines: [{ text: "I love you", start: 12.3, end: 15.2 }] };

  test("tokenize, split and merge keep text, times and tokens in step", () => {
    const tokenized = tokenizeLineAt(timed, 0);
    assert.equal(tokenized.lines[0].tokens.length, 3);
    const split = splitLine(tokenized, 0, 1);
    assert.equal(split.lines.length, 2);
    assert.equal(split.lines[0].text, "I");
    assert.equal(split.lines[0].end, split.lines[1].start);
    assert.equal(split.lines[1].text, "love you");
    assert.equal(split.lines[1].end, 15.2);
    const merged = mergeLines(split, 0);
    assert.equal(merged.lines.length, 1);
    assert.equal(merged.lines[0].text, "I love you");
    assert.equal(merged.lines[0].tokens.length, 3);
    assert.equal(merged.lines[0].start, 12.3);
  });

  test("split and merge refuse what has no meaning", () => {
    assert.equal(splitLine(timed, 0, 0).lines.length, 1);       // nothing before the boundary
    assert.equal(mergeLines(timed, 0).lines.length, 1);         // nothing to merge with
  });

  test("a translation attaches, changes and goes away", () => {
    const withTranslation = setLineTranslation(timed, 0, "我爱你");
    assert.equal(withTranslation.lines[0].translation, "我爱你");
    assert.equal(timed.lines[0].translation, undefined);        // the input is untouched
    assert.equal(setLineTranslation(withTranslation, 0, undefined).lines[0].translation, undefined);
  });

  test("lines move as whole units and never below zero", () => {
    const line = { version: 1, lines: [{ text: "x", start: 1, end: 2, tokens: [{ text: "x", start: 1, end: 2 }] }] };
    const moved = moveLine(line, 0, 0.5);
    assert.equal(moved.lines[0].start, 1.5);
    assert.equal(moved.lines[0].tokens[0].end, 2.5);
    assert.equal(moveLine(line, 0, -5).lines[0].start, 0);      // clamped, not refused
    assert.equal(earliestTime(line), 1);
  });

  test("a global offset shifts everything, or refuses when it would cross zero", () => {
    assert.ok(shiftAll(timed, -1000) === null);
    const shifted = shiftAll(timed, 0.2);
    assert.equal(shifted.lines[0].start, 12.5);
    assert.equal(timed.lines[0].start, 12.3);
  });

  test("adding, deleting and re-spanning a line", () => {
    const added = addLine(timed, 0, "New");
    assert.equal(added.lines.length, 2);
    assert.equal(added.lines[0].text, "New");
    assert.equal(deleteLine(added, 0).lines.length, 1);
    const respanned = setLineSpan(timed, 0, { end: 16 });
    assert.equal(respanned.lines[0].end, 16);
    assert.equal(setTokenSpan(tokenizeLineAt(timed, 0), 0, 1, { start: 13 }).lines[0].tokens[1].start, 13);
  });

  test("tokenize works before any timing exists", () => {
    const plain = { version: 1, lines: [{ text: "你好，世界" }] };
    const tokenized = tokenizeLineAt(plain, 0);
    assert.deepEqual(tokenized.lines[0].tokens.map((token) => token.text), ["你", "好，", "世", "界"]);
    assert.equal(tokenized.lines[0].tokens[0].start, undefined);
    assert.equal(tokenized.lines[0].start, undefined);
    assert.equal(tokenizeLineAt({ version: 1, lines: [{ text: "   " }] }, 0).lines[0].tokens, undefined);
  });

  test("tokenizeAllLines cuts every text line and leaves timed ones spread", () => {
    const doc = { version: 1, lines: [{ text: "I love you", start: 0, end: 3 }, { text: "再 见" }, { text: "" }] };
    const cut = tokenizeAllLines(doc);
    assert.equal(cut.lines[0].tokens.length, 3);
    assert.equal(cut.lines[0].tokens[0].start, 0);
    assert.equal(cut.lines[0].tokens[2].end, 3);
    assert.equal(cut.lines[1].tokens.length, 2);
    assert.equal(cut.lines[1].tokens[0].start, undefined);
    assert.equal(cut.lines[2].tokens, undefined);
    assert.equal(doc.lines[1].tokens, undefined);          // the input is untouched
  });

  test("mergeTokens joins a range into one word, inner spacing included", () => {
    const doc = tokenizeLineAt({ version: 1, lines: [{ text: "Hello, big world", start: 0, end: 3 }] }, 0);
    const merged = mergeTokens(doc, 0, 0, 1);
    assert.equal(merged.lines[0].tokens.length, 2);
    assert.equal(merged.lines[0].tokens[0].text, "Hello, big");
    assert.equal(merged.lines[0].tokens[0].start, doc.lines[0].tokens[0].start);
    assert.equal(merged.lines[0].tokens[0].end, doc.lines[0].tokens[1].end);
    assert.equal(merged.lines[0].text, "Hello, big world");  // the line itself is untouched
    assert.equal(mergeTokens(doc, 0, 1, 1), doc);            // a range needs two words
    assert.equal(doc.lines[0].tokens.length, 3);
  });

  test("mergeTokens of untimed words stays untimed", () => {
    const doc = { version: 1, lines: [{ text: "你好世界", tokens: [{ text: "你" }, { text: "好" }, { text: "世" }, { text: "界" }] }] };
    const merged = mergeTokens(doc, 0, 1, 2);
    assert.equal(merged.lines[0].tokens.length, 3);
    assert.equal(merged.lines[0].tokens[1].text, "好世");
    assert.equal(merged.lines[0].tokens[1].start, undefined);
  });

  test("renaming a word rewrites the sentence around it, timing untouched", () => {
    const doc = tokenizeLineAt({ version: 1, lines: [{ text: "Hello, big world", start: 0, end: 3 }] }, 0);
    const renamed = setTokenText(doc, 0, 1, "small");
    assert.deepEqual(renamed.lines[0].tokens.map((token) => token.text), ["Hello,", "small", "world"]);
    assert.equal(renamed.lines[0].text, "Hello, small world");
    assert.equal(renamed.lines[0].tokens[1].start, doc.lines[0].tokens[1].start);
    assert.equal(renamed.lines[0].tokens[1].end, doc.lines[0].tokens[1].end);
    assert.equal(doc.lines[0].text, "Hello, big world");            // the input document is untouched
  });

  test("a renamed word keeps the renderer able to find every word in the sentence", () => {
    const doc = tokenizeLineAt({ version: 1, lines: [{ text: "海阔天空" }] }, 0);
    const renamed = setTokenText(doc, 0, 2, "云");
    assert.equal(renamed.lines[0].text, "海阔云空");
    assert.deepEqual(tokenOffsets(renamed.lines[0].text, renamed.lines[0].tokens), [0, 1, 2, 3]);
  });

  test("a sentence that drifted from its words is rebuilt from them", () => {
    const drifted = { version: 1, lines: [{ text: "completely different words", tokens: [{ text: "One" }, { text: "two" }] }] };
    const fixed = setTokenText(drifted, 0, 1, "second");
    assert.equal(fixed.lines[0].text, "One second");
    assert.equal(setTokenText(drifted, 0, 9, "nope"), drifted);      // no such word: nothing changes
  });

  test("a word's end carries to the next word's start", () => {
    const doc = { version: 1, lines: [{ text: "a b c", tokens: [{ text: "a" }, { text: "b" }, { text: "c" }] }] };
    const closed = setTokenSpan(doc, 0, 0, { end: 1.25 });
    assert.equal(closed.lines[0].tokens[0].end, 1.25);
    assert.equal(closed.lines[0].tokens[1].start, 1.25);           // the boundary belongs to both
    assert.equal(closed.lines[0].tokens[2].start, undefined);      // only the neighbour follows
    assert.equal(doc.lines[0].tokens[1].start, undefined);         // the input document is untouched
    const last = setTokenSpan(closed, 0, 2, { end: 3 });
    assert.equal(last.lines[0].tokens[2].end, 3);                  // the final word has no neighbour
  });

  test("a late start stays a gap instead of dragging the previous end", () => {
    const doc = { version: 1, lines: [{ text: "a b", tokens: [{ text: "a", start: 0, end: 1 }, { text: "b" }] }] };
    const started = setTokenSpan(doc, 0, 1, { start: 2 });
    assert.equal(started.lines[0].tokens[1].start, 2);
    assert.equal(started.lines[0].tokens[0].end, 1);               // the previous word keeps its end
  });

  test("time fields read m:ss.mmm and bare seconds alike", () => {
    assert.equal(parseStamp("0:30.474"), 30.474);
    assert.equal(parseStamp("30.474"), 30.474);                      // bare seconds get their 0:
    assert.equal(parseStamp("1:15"), 75);
    assert.equal(parseStamp("1:15.25"), 75.25);
    assert.equal(parseStamp(" 0:05 "), 5);
    assert.equal(parseStamp("0：05"), 5);                            // a full-width colon is a colon
    assert.equal(parseStamp(""), null);
    assert.equal(parseStamp("  "), null);
    assert.equal(parseStamp("1:"), null);                            // both halves must be given
    assert.equal(parseStamp(":30"), null);
    assert.equal(parseStamp("0:30:00"), null);
    assert.equal(parseStamp("abc"), null);
    assert.equal(parseStamp("-5"), null);
  });

  test("a seconds part over 59 carries instead of being printed back", () => {
    assert.equal(parseStamp("0:75.5"), 75.5);
    assert.equal(stampText(75.5), "1:15.500");                       // never shows 0:75
    assert.equal(stampText(9.5), "0:09.500");
    assert.equal(stampText(0), "0:00.000");
    assert.equal(stampText(undefined), "–:––.–––");
    assert.equal(parseStamp(stampText(90.474)), 90.474);             // the field's round trip holds
  });

  test("an untimed token cannot be nudged, and shifts leave it alone", () => {
    const doc = { version: 1, lines: [{ text: "x y", tokens: [{ text: "x" }, { text: "y", start: 1, end: 2 }] }] };
    assert.equal(moveToken(doc, 0, 0, 0.5), doc);
    assert.equal(earliestTime(doc), 1);                      // untimed words contribute nothing
    const shifted = shiftAll(doc, 0.5);
    assert.equal(shifted.lines[0].tokens[1].start, 1.5);
    assert.equal(shifted.lines[0].tokens[0].start, undefined);
  });
});

describe("lyrics validation", () => {
  const doc = { version: 1, lines: [{ text: "Hi", start: 1, end: 2, translation: "你好", tokens: [{ text: "Hi", start: 1, end: 2 }] }] };

  test("accepts a document and rebuilds it without unknown fields", () => {
    const value = validateLyricsDoc({ ...doc, extra: true, lines: [{ ...doc.lines[0], extra: 1 }] });
    assert.equal(value.lines[0].text, "Hi");
    assert.equal(value.extra, undefined);
    assert.equal(value.lines[0].extra, undefined);
  });

  test("refuses the shapes that would break the renderer", () => {
    assert.throws(() => validateLyricsDoc(null), LyricsValidationError);
    assert.throws(() => validateLyricsDoc({ version: 2, lines: [] }), LyricsValidationError);
    assert.throws(() => validateLyricsDoc({ version: 1, lines: [{ text: 1 }] }), LyricsValidationError);
    assert.throws(() => validateLyricsDoc({ version: 1, lines: [{ text: "a", start: -1 }] }), LyricsValidationError);
    assert.throws(() => validateLyricsDoc({ version: 1, lines: [{ text: "a", start: NaN }] }), LyricsValidationError);
    assert.throws(() => validateLyricsDoc({ version: 1, lines: Array.from({ length: MAX_LYRICS_LINES + 1 }, () => ({ text: "x" })) }), LyricsValidationError);
    assert.throws(() => validateLyricsDoc({
      version: 1,
      lines: [{ text: "a", tokens: Array.from({ length: MAX_TOKENS_PER_LINE + 1 }, () => ({ text: "x", start: 0, end: 1 })) }],
    }), LyricsValidationError);
  });

  test("the lenient path drops one unreadable line instead of the document", () => {
    const value = coerceLyricsDoc({ version: 1, lines: [{ text: "ok", start: 0, end: 1 }, { text: 42 }, { text: "fine" }] });
    assert.deepEqual(value.lines.map((line) => line.text), ["ok", "fine"]);
    assert.equal(coerceLyricsDoc("nope"), null);
  });

  test("tokens may be untimed, but a bad time still throws", () => {
    const value = validateLyricsDoc({ version: 1, lines: [{ text: "a", tokens: [{ text: "a" }, { text: "b", start: 1 }, { text: "c", end: 2 }] }] });
    assert.equal(value.lines[0].tokens[0].start, undefined);
    assert.equal(value.lines[0].tokens[0].end, undefined);
    assert.equal(value.lines[0].tokens[1].start, 1);
    assert.equal(value.lines[0].tokens[2].end, 2);
    assert.throws(() => validateLyricsDoc({ version: 1, lines: [{ text: "a", tokens: [{ text: "a", start: -1 }] }] }), LyricsValidationError);
    assert.equal(coerceLyricsDoc({ version: 1, lines: [{ text: "a", tokens: [{ text: "a" }] }] }).lines[0].tokens[0].start, undefined);
  });
});

describe("the asset index and the lyrics document", () => {
  test("the stored document never rides the index stream", () => {
    const entry = assetIndexEntry({
      id: "1", ownerEmail: "", name: "a.mp3", mediaKind: "audio", format: "mp3", status: "ready",
      metadata: { lyrics: "plain", lyricsDoc: JSON.stringify({ version: 1, lines: [] }) },
      filePath: "", createdAt: "", updatedAt: "",
    });
    assert.equal(entry.lyrics, "plain");
    assert.ok(!("lyricsDoc" in entry));
  });
});
