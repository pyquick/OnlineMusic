import { round3, type LyricsDoc, type LyricsLine, type LyricsToken } from "./types";

/**
 * The timeline engine: pure questions asked of a document and a position. The playback
 * synchroniser asks these once per animation frame, so every function here is allocation-free
 * and has to stay that way.
 */

export type LineState = "past" | "active" | "future";

export function hasTiming(doc: LyricsDoc): boolean {
  return doc.lines.some((line) => typeof line.start === "number");
}

/**
 * A line's effective end: its own, else the next timed line's start (a gap still ends it), else
 * its last token's end. Infinity when nothing says — the last line of a document with no tokens.
 */
export function lineEnd(doc: LyricsDoc, index: number): number {
  const line = doc.lines[index];
  if (!line) return Number.POSITIVE_INFINITY;
  if (typeof line.end === "number") return line.end;
  for (let next = index + 1; next < doc.lines.length; next += 1) {
    const start = doc.lines[next].start;
    if (typeof start === "number") return start;
  }
  const tokens = line.tokens;
  const last = tokens?.[tokens.length - 1];
  if (last) return last.end;
  return Number.POSITIVE_INFINITY;
}

/** The last timed line that has started at `t`, or -1 before the first one. */
export function lineAt(doc: LyricsDoc, t: number): number {
  let found = -1;
  for (let index = 0; index < doc.lines.length; index += 1) {
    const start = doc.lines[index].start;
    if (typeof start !== "number") continue;
    if (start <= t) found = index;
    else break;
  }
  return found;
}

export function lineState(doc: LyricsDoc, index: number, t: number): LineState {
  const line = doc.lines[index];
  if (!line || typeof line.start !== "number") return "future";
  if (t < line.start) return "future";
  return t >= lineEnd(doc, index) ? "past" : "active";
}

/** What the view keeps centred: the active line, else the last one that played (gaps stay put). */
export function focusIndex(doc: LyricsDoc, t: number): number {
  return lineAt(doc, t);
}

/** How far through the line's own span `t` is; the fallback fill for a line without tokens. */
export function lineFill(doc: LyricsDoc, index: number, t: number): number {
  const line = doc.lines[index];
  if (!line || typeof line.start !== "number") return 0;
  const end = lineEnd(doc, index);
  if (!Number.isFinite(end) || end <= line.start) return t >= line.start ? 1 : 0;
  return clamp((t - line.start) / (end - line.start));
}

export function tokenFill(token: LyricsToken, t: number): number {
  if (token.end <= token.start) return t >= token.end ? 1 : 0;
  return clamp((t - token.start) / (token.end - token.start));
}

/**
 * The renderer's one question per frame, per line: which token is live and how far through.
 * `index === tokens.length` means every token has played; `-1` means none has started.
 */
export function tokenProgress(line: LyricsLine, t: number): { index: number; fill: number } {
  const tokens = line.tokens ?? [];
  if (tokens.length === 0) return { index: -1, fill: 0 };
  let index = -1;
  for (let position = 0; position < tokens.length; position += 1) {
    if (tokens[position].start <= t) index = position;
    else break;
  }
  if (index === -1) return { index: -1, fill: 0 };
  if (index === tokens.length - 1 && t >= tokens[index].end) return { index: tokens.length, fill: 1 };
  return { index, fill: tokenFill(tokens[index], t) };
}

/** The end of everything timed in the document, for the editor's waveform and export. */
export function docDuration(doc: LyricsDoc): number {
  let end = 0;
  for (let index = 0; index < doc.lines.length; index += 1) {
    const line = doc.lines[index];
    if (typeof line.start !== "number" && !line.tokens?.length) continue;
    const value = lineEnd(doc, index);
    if (Number.isFinite(value) && value > end) end = value;
    for (const token of line.tokens ?? []) if (token.end > end) end = token.end;
  }
  return round3(end);
}

function clamp(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
