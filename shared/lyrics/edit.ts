import { round3, type LyricsDoc, type LyricsLine, type LyricsToken } from "./types";
import { tokenizeLine } from "./tokenizer";

/**
 * Every change the editor can make, as an immutable document → document function. The editor's
 * undo stack is a list of documents, so an operation that mutated in place would poison the whole
 * history; nothing here touches its input.
 */

function cloneLine(line: LyricsLine): LyricsLine {
  return { ...line, tokens: line.tokens?.map((token) => ({ ...token })) };
}

function replace(doc: LyricsDoc, index: number, change: (line: LyricsLine) => LyricsLine): LyricsDoc {
  const lines = doc.lines.slice();
  lines[index] = change(cloneLine(lines[index]));
  return { ...doc, lines };
}

function replaceTokens(doc: LyricsDoc, lineIndex: number, change: (tokens: LyricsToken[]) => LyricsToken[]): LyricsDoc {
  return replace(doc, lineIndex, (line) => ({ ...line, tokens: change(line.tokens?.map((token) => ({ ...token })) ?? []) }));
}

export function addLine(doc: LyricsDoc, index: number = doc.lines.length, text = ""): LyricsDoc {
  const lines = doc.lines.slice();
  const at = Math.max(0, Math.min(index, lines.length));
  lines.splice(at, 0, { text });
  return { ...doc, lines };
}

export function deleteLine(doc: LyricsDoc, index: number): LyricsDoc {
  if (index < 0 || index >= doc.lines.length) return doc;
  const lines = doc.lines.slice();
  lines.splice(index, 1);
  return { ...doc, lines };
}

export function setLineText(doc: LyricsDoc, index: number, text: string): LyricsDoc {
  return replace(doc, index, (line) => ({ ...line, text }));
}

export function setLineTranslation(doc: LyricsDoc, index: number, translation: string | undefined): LyricsDoc {
  return replace(doc, index, (line) => {
    const next = { ...line };
    if (translation === undefined || translation === "") delete next.translation;
    else next.translation = translation;
    return next;
  });
}

/** Sets only the edges present in `span`; a line without timing gains its first start this way. */
export function setLineSpan(doc: LyricsDoc, index: number, span: { start?: number; end?: number }): LyricsDoc {
  return replace(doc, index, (line) => ({
    ...line,
    start: span.start === undefined ? line.start : round3(Math.max(0, span.start)),
    end: span.end === undefined ? line.end : round3(Math.max(0, span.end)),
  }));
}

function lineFloor(line: LyricsLine): number {
  let floor = Number.POSITIVE_INFINITY;
  if (line.start !== undefined) floor = Math.min(floor, line.start);
  if (line.end !== undefined) floor = Math.min(floor, line.end);
  for (const token of line.tokens ?? []) {
    if (typeof token.start === "number") floor = Math.min(floor, token.start);
    if (typeof token.end === "number") floor = Math.min(floor, token.end);
  }
  return Number.isFinite(floor) ? floor : 0;
}

/** Moves the whole line — its span and its tokens — never below zero. Untimed tokens hold still. */
export function moveLine(doc: LyricsDoc, index: number, delta: number): LyricsDoc {
  const line = doc.lines[index];
  if (!line) return doc;
  const shift = Math.max(delta, -lineFloor(line));
  if (shift === 0) return doc;
  return replace(doc, index, (entry) => ({
    ...entry,
    start: entry.start === undefined ? undefined : round3(entry.start + shift),
    end: entry.end === undefined ? undefined : round3(entry.end + shift),
    tokens: entry.tokens?.map((token) => ({
      text: token.text,
      start: typeof token.start === "number" ? round3(token.start + shift) : undefined,
      end: typeof token.end === "number" ? round3(token.end + shift) : undefined,
    })),
  }));
}

/**
 * The automatic first cut: the line's own span spread over its tokens by weight — or, when the
 * line has no span yet, the words without any times. Tokenizing before timing is the point: the
 * words can be prepared and timed word by word.
 */
export function tokenizeLineAt(doc: LyricsDoc, index: number): LyricsDoc {
  const line = doc.lines[index];
  if (!line || !line.text.trim()) return doc;
  const timed = typeof line.start === "number" && typeof line.end === "number";
  return replace(doc, index, (entry) => ({
    ...entry,
    tokens: timed ? tokenizeLine(entry.text, entry.start, entry.end) : tokenizeLine(entry.text),
  }));
}

/** Tokenizes every line that has text and no tokens yet — the paste step's automatic cut. */
export function tokenizeAllLines(doc: LyricsDoc): LyricsDoc {
  let next = doc;
  for (let index = 0; index < doc.lines.length; index += 1) {
    const line = doc.lines[index];
    if (line.tokens?.length || !line.text.trim()) continue;
    next = tokenizeLineAt(next, index);
  }
  return next;
}

/**
 * Renames one word, and the sentence follows: the line's text is its words in order, and the
 * renderer finds each word inside that text to keep the gaps between them, so a rename that left
 * the sentence behind would break every fill from this word on. The new text is spliced into the
 * exact place the word occupied; when the line has drifted away from its words (hand-edited text
 * that no longer contains one of them) the words are simply joined back together instead.
 */
export function setTokenText(doc: LyricsDoc, lineIndex: number, tokenIndex: number, text: string): LyricsDoc {
  const line = doc.lines[lineIndex];
  const tokens = line?.tokens;
  const token = tokens?.[tokenIndex];
  if (!line || !tokens || !token) return doc;
  const offsets = tokenOffsets(line.text, tokens);
  const renamed = tokens.map((entry, index) => (index === tokenIndex ? text : entry.text));
  const nextText = offsets.length
    ? line.text.slice(0, offsets[tokenIndex]) + text + line.text.slice(offsets[tokenIndex] + token.text.length)
    : renamed.reduce((joined, word) => joinText(joined, word), "");
  return replace(doc, lineIndex, (entry) => ({
    ...entry,
    text: nextText,
    tokens: (entry.tokens ?? []).map((current, index) => (index === tokenIndex ? { ...current, text } : current)),
  }));
}

/**
 * Sets the edges present in `span`. Neighbouring words share their boundary — a word's end *is*
 * the next word's start, the same rule the Enter stamps follow — so an end written here carries
 * straight to the next word's start; a word never ends where the next one does not begin. A
 * start is left as an edit of its own: a deliberately late word (a rest before it) stays a gap
 * rather than dragging the previous word's end along with it.
 */
export function setTokenSpan(doc: LyricsDoc, lineIndex: number, tokenIndex: number, span: { start?: number; end?: number }): LyricsDoc {
  return replaceTokens(doc, lineIndex, (tokens) => {
    const token = tokens[tokenIndex];
    if (!token) return tokens;
    const end = span.end === undefined ? token.end : round3(Math.max(0, span.end));
    tokens[tokenIndex] = {
      text: token.text,
      start: span.start === undefined ? token.start : round3(Math.max(0, span.start)),
      end,
    };
    const next = tokens[tokenIndex + 1];
    if (span.end !== undefined && next) tokens[tokenIndex + 1] = { ...next, start: end };
    return tokens;
  });
}

export function moveToken(doc: LyricsDoc, lineIndex: number, tokenIndex: number, delta: number): LyricsDoc {
  const token = doc.lines[lineIndex]?.tokens?.[tokenIndex];
  if (!token || typeof token.start !== "number" || typeof token.end !== "number") return doc;
  const from = token.start;
  const to = token.end;
  const shift = Math.max(delta, -Math.min(from, to));
  if (shift === 0) return doc;
  return replaceTokens(doc, lineIndex, (tokens) => {
    tokens[tokenIndex] = { text: token.text, start: round3(from + shift), end: round3(to + shift) };
    return tokens;
  });
}

export function deleteToken(doc: LyricsDoc, lineIndex: number, tokenIndex: number): LyricsDoc {
  return replaceTokens(doc, lineIndex, (tokens) => {
    tokens.splice(tokenIndex, 1);
    return tokens;
  });
}

/** Where each token's text sits in the line's text; the renderer uses it to keep the gaps. */
export function tokenOffsets(text: string, tokens: LyricsToken[]): number[] {
  const offsets: number[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const at = text.indexOf(token.text, cursor);
    if (at < 0) return [];
    offsets.push(at);
    cursor = at + token.text.length;
  }
  return offsets;
}

/**
 * Splits at a token boundary: tokens before it stay with the left half, it and everything after
 * go right. The translation belongs to the left half — it describes the words the user just read.
 */
export function splitLine(doc: LyricsDoc, lineIndex: number, tokenIndex: number): LyricsDoc {
  const line = doc.lines[lineIndex];
  const tokens = line?.tokens;
  if (!line || !tokens || tokenIndex <= 0 || tokenIndex >= tokens.length) return doc;
  const offsets = tokenOffsets(line.text, tokens);
  const boundary = offsets[tokenIndex] ?? Math.round((line.text.length * tokenIndex) / tokens.length);
  const leftTokens = tokens.slice(0, tokenIndex).map((token) => ({ ...token }));
  const rightTokens = tokens.slice(tokenIndex).map((token) => ({ ...token }));
  // The cut is the split token's start; an untimed token has none, so both halves stay untimed.
  const cutAt = tokens[tokenIndex].start;
  const cut = typeof cutAt === "number" ? round3(cutAt) : undefined;
  const left: LyricsLine = {
    text: line.text.slice(0, boundary).trim(),
    start: line.start,
    end: cut,
    tokens: leftTokens.length ? leftTokens : undefined,
  };
  if (line.translation) left.translation = line.translation;
  const right: LyricsLine = {
    text: line.text.slice(boundary).trim(),
    start: cut,
    end: line.end,
    tokens: rightTokens.length ? rightTokens : undefined,
  };
  const lines = doc.lines.slice();
  lines.splice(lineIndex, 1, left, right);
  return { ...doc, lines };
}

/** The glue between two merged texts: Latin gets a space, CJK does not. */
function joinText(left: string, right: string): string {
  const cjk = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
  const glue = left && right && !cjk.test(left.slice(-1)) && !cjk.test(right[0]) ? " " : "";
  return left + glue + right;
}

/**
 * Merges adjacent tokens into one: the text is the line's own slice from the first token's start
 * to the last token's end (so inner spacing survives), the span is their envelope, and untimed
 * tokens simply contribute no edge. This is the drag-across-words + Enter operation.
 */
export function mergeTokens(doc: LyricsDoc, lineIndex: number, from: number, to: number): LyricsDoc {
  const line = doc.lines[lineIndex];
  const tokens = line?.tokens;
  if (!line || !tokens || from < 0 || to >= tokens.length || to <= from) return doc;
  const offsets = tokenOffsets(line.text, tokens);
  const text = offsets.length
    ? line.text.slice(offsets[from], offsets[to] + tokens[to].text.length)
    : tokens.slice(from, to + 1).reduce((joined, token) => joinText(joined, token.text), "");
  const starts = tokens.slice(from, to + 1).map((token) => token.start).filter((value): value is number => typeof value === "number");
  const ends = tokens.slice(from, to + 1).map((token) => token.end).filter((value): value is number => typeof value === "number");
  const merged: LyricsToken = { text };
  if (starts.length) merged.start = round3(Math.min(...starts));
  if (ends.length) merged.end = round3(Math.max(...ends));
  return replaceTokens(doc, lineIndex, (entries) => {
    entries.splice(from, to - from + 1, merged);
    return entries;
  });
}

/** Joins a line with the next one; the left line keeps its translation unless it has none. */
export function mergeLines(doc: LyricsDoc, lineIndex: number): LyricsDoc {
  const left = doc.lines[lineIndex];
  const right = doc.lines[lineIndex + 1];
  if (!left || !right) return doc;
  const starts = [left.start, right.start].filter((value): value is number => typeof value === "number");
  const ends = [left.end, right.end].filter((value): value is number => typeof value === "number");
  // Untimed tokens sort last but keep their relative order (the sort is stable).
  const at = (token: LyricsToken) => (typeof token.start === "number" ? token.start : Number.POSITIVE_INFINITY);
  const tokens = [...(left.tokens ?? []).map((token) => ({ ...token })), ...(right.tokens ?? []).map((token) => ({ ...token }))].sort((a, b) => at(a) - at(b));
  const merged: LyricsLine = {
    text: joinText(left.text, right.text),
    start: starts.length ? Math.min(...starts) : undefined,
    end: ends.length ? Math.max(...ends) : undefined,
    tokens: tokens.length ? tokens : undefined,
  };
  const translation = left.translation || right.translation;
  if (translation) merged.translation = translation;
  const lines = doc.lines.slice();
  lines.splice(lineIndex, 2, merged);
  return { ...doc, lines };
}

/** Every defined time in the document, in order — what a global offset has to keep non-negative. */
export function earliestTime(doc: LyricsDoc): number | undefined {
  let earliest: number | undefined;
  for (const line of doc.lines) {
    for (const value of [line.start, line.end]) {
      if (typeof value === "number" && (earliest === undefined || value < earliest)) earliest = value;
    }
    for (const token of line.tokens ?? []) {
      if (typeof token.start === "number" && (earliest === undefined || token.start < earliest)) earliest = token.start;
      if (typeof token.end === "number" && (earliest === undefined || token.end < earliest)) earliest = token.end;
    }
  }
  return earliest;
}

/** Shifts every time in the document; null when that would push something below zero. */
export function shiftAll(doc: LyricsDoc, delta: number): LyricsDoc | null {
  if (delta === 0) return doc;
  const earliest = earliestTime(doc);
  if (earliest === undefined) return doc;
  if (earliest + delta < 0) return null;
  const lines = doc.lines.map((line) => ({
    ...line,
    start: line.start === undefined ? undefined : round3(line.start + delta),
    end: line.end === undefined ? undefined : round3(line.end + delta),
    tokens: line.tokens?.map((token) => ({
      text: token.text,
      start: typeof token.start === "number" ? round3(token.start + delta) : undefined,
      end: typeof token.end === "number" ? round3(token.end + delta) : undefined,
    })),
  }));
  return { ...doc, lines };
}
