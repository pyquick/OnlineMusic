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
  for (const token of line.tokens ?? []) floor = Math.min(floor, token.start, token.end);
  return Number.isFinite(floor) ? floor : 0;
}

/** Moves the whole line — its span and its tokens — never below zero. */
export function moveLine(doc: LyricsDoc, index: number, delta: number): LyricsDoc {
  const line = doc.lines[index];
  if (!line) return doc;
  const shift = Math.max(delta, -lineFloor(line));
  if (shift === 0) return doc;
  return replace(doc, index, (entry) => ({
    ...entry,
    start: entry.start === undefined ? undefined : round3(entry.start + shift),
    end: entry.end === undefined ? undefined : round3(entry.end + shift),
    tokens: entry.tokens?.map((token) => ({ text: token.text, start: round3(token.start + shift), end: round3(token.end + shift) })),
  }));
}

/** The automatic first cut: the line's own span spread over its tokens by weight. */
export function tokenizeLineAt(doc: LyricsDoc, index: number): LyricsDoc {
  const line = doc.lines[index];
  if (!line || typeof line.start !== "number" || typeof line.end !== "number" || !line.text.trim()) return doc;
  return replace(doc, index, (entry) => ({ ...entry, tokens: tokenizeLine(entry.text, entry.start as number, entry.end as number) }));
}

export function setTokenText(doc: LyricsDoc, lineIndex: number, tokenIndex: number, text: string): LyricsDoc {
  return replaceTokens(doc, lineIndex, (tokens) => {
    if (!tokens[tokenIndex]) return tokens;
    tokens[tokenIndex] = { ...tokens[tokenIndex], text };
    return tokens;
  });
}

export function setTokenSpan(doc: LyricsDoc, lineIndex: number, tokenIndex: number, span: { start?: number; end?: number }): LyricsDoc {
  return replaceTokens(doc, lineIndex, (tokens) => {
    const token = tokens[tokenIndex];
    if (!token) return tokens;
    tokens[tokenIndex] = {
      text: token.text,
      start: span.start === undefined ? token.start : round3(Math.max(0, span.start)),
      end: span.end === undefined ? token.end : round3(Math.max(0, span.end)),
    };
    return tokens;
  });
}

export function moveToken(doc: LyricsDoc, lineIndex: number, tokenIndex: number, delta: number): LyricsDoc {
  const token = doc.lines[lineIndex]?.tokens?.[tokenIndex];
  if (!token) return doc;
  const shift = Math.max(delta, -Math.min(token.start, token.end));
  if (shift === 0) return doc;
  return replaceTokens(doc, lineIndex, (tokens) => {
    tokens[tokenIndex] = { text: token.text, start: round3(token.start + shift), end: round3(token.end + shift) };
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
  const cut = tokens[tokenIndex].start;
  const left: LyricsLine = {
    text: line.text.slice(0, boundary).trim(),
    start: line.start,
    end: line.start === undefined ? undefined : round3(cut),
    tokens: leftTokens.length ? leftTokens : undefined,
  };
  if (line.translation) left.translation = line.translation;
  const right: LyricsLine = {
    text: line.text.slice(boundary).trim(),
    start: line.start === undefined ? undefined : round3(cut),
    end: line.end,
    tokens: rightTokens.length ? rightTokens : undefined,
  };
  const lines = doc.lines.slice();
  lines.splice(lineIndex, 1, left, right);
  return { ...doc, lines };
}

/** Joins a line with the next one; the left line keeps its translation unless it has none. */
export function mergeLines(doc: LyricsDoc, lineIndex: number): LyricsDoc {
  const left = doc.lines[lineIndex];
  const right = doc.lines[lineIndex + 1];
  if (!left || !right) return doc;
  const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  const glue = left.text && right.text && !cjk.test(left.text.slice(-1)) && !cjk.test(right.text[0]) ? " " : "";
  const starts = [left.start, right.start].filter((value): value is number => typeof value === "number");
  const ends = [left.end, right.end].filter((value): value is number => typeof value === "number");
  const tokens = [...(left.tokens ?? []).map((token) => ({ ...token })), ...(right.tokens ?? []).map((token) => ({ ...token }))].sort((a, b) => a.start - b.start);
  const merged: LyricsLine = {
    text: left.text + glue + right.text,
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
      if (earliest === undefined || token.start < earliest) earliest = token.start;
      if (token.end < earliest) earliest = token.end;
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
    tokens: line.tokens?.map((token) => ({ text: token.text, start: round3(token.start + delta), end: round3(token.end + delta) })),
  }));
  return { ...doc, lines };
}
