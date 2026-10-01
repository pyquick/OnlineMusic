import { LYRICS_DOC_VERSION, emptyLyricsDoc, round3, type LyricsDoc, type LyricsLine, type LyricsToken } from "./types";
import { coerceLyricsDoc } from "./validation";

/**
 * Reading lyrics that are still text: LRC with its stamps (and, when present, the enhanced
 * `<mm:ss.xx>` word tags some tools write), or plain lines. This is the only path a song with no
 * stored document has, and the editor's starting point for one — so it must never throw and never
 * invent timing it did not read.
 */

const LRC_LINE = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;
const LRC_TIME = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const WORD_TIME = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>/g;
const LRC_TAG = /^\[[a-zA-Z#]+:[^\]]*\]$/;

/** `matchAll` would drag the project's es5 target into an iteration helper; `exec` does not. */
function matches(regex: RegExp, text: string): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  regex.lastIndex = 0;
  for (let match = regex.exec(text); match; match = regex.exec(text)) found.push(match);
  return found;
}

function stampOf(minutes: string, seconds: string, fraction?: string): number {
  const value = Number(minutes) * 60 + Number(seconds) + (fraction ? Number(`0.${fraction}`) : 0);
  return round3(value);
}

type ParsedLine = {
  start: number;
  text: string;
  end?: number;
  tokens?: { text: string; start: number; end?: number }[];
};

/** Enhanced-LRC word tags inside one line, when the line carries any. */
function splitWordTags(rest: string): { text: string; tokens?: ParsedLine["tokens"]; end?: number } {
  const chunks: { text: string; time: number | null }[] = [];
  let cursor = 0;
  for (const match of matches(WORD_TIME, rest)) {
    chunks.push({ text: rest.slice(cursor, match.index), time: stampOf(match[1], match[2], match[3]) });
    cursor = match.index + match[0].length;
  }
  chunks.push({ text: rest.slice(cursor), time: null });
  if (chunks.length === 1) return { text: chunks[0].text.trim() };
  const text = chunks.map((chunk) => chunk.text).join("").replace(/\s+/g, " ").trim();
  const tokens: NonNullable<ParsedLine["tokens"]> = [];
  let lastTime: number | undefined;
  for (const chunk of chunks) {
    const value = chunk.text.trim();
    if (chunk.time !== null) lastTime = chunk.time;
    if (value) tokens.push({ text: value, start: chunk.time ?? lastTime ?? 0, end: undefined });
  }
  // Enhanced LRC writes the line's own end as a trailing empty tag; the final chunk carries it.
  const tail = chunks[chunks.length - 1];
  const end = tail.time === null && !tail.text.trim() && lastTime !== undefined ? lastTime : undefined;
  return { text, tokens: tokens.length ? tokens : undefined, end };
}

function parseLrc(raw: string): LyricsDoc {
  const entries: ParsedLine[] = [];
  const untimed: string[] = [];
  let offsetSeconds = 0;
  for (const source of raw.split("\n")) {
    const line = source.trim();
    if (!line) continue;
    const offset = line.match(/^\[offset:\s*([+-]?\d+(?:\.\d+)?)\s*\]$/i);
    if (offset) {
      offsetSeconds = Number(offset[1]) / 1000;
      continue;
    }
    const stamps = matches(LRC_TIME, line);
    if (stamps.length === 0) {
      if (!LRC_TAG.test(line)) untimed.push(line);
      continue;
    }
    const rest = line.replace(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g, "").trim();
    const parsed = splitWordTags(rest);
    for (const stamp of stamps) {
      entries.push({ start: stampOf(stamp[1], stamp[2], stamp[3]), text: parsed.text, tokens: parsed.tokens?.map((token) => ({ ...token })), end: parsed.end });
    }
  }

  entries.sort((left, right) => left.start - right.start);
  // An empty stamped line is a boundary, not a lyric: it must not render as a blank row, but its
  // stamp still ends the line before it and starts the one after.
  const starts = entries.map((entry) => entry.start);
  const kept = entries.filter((entry) => entry.text);
  for (const entry of kept) {
    if (entry.end === undefined) entry.end = starts.find((value) => value > entry.start);
  }
  const lines: LyricsLine[] = kept.map((entry) => {
    const tokens: LyricsToken[] | undefined = entry.tokens?.length
      ? entry.tokens.map((token, index) => ({
        text: token.text,
        start: round3(token.start),
        end: round3(token.end ?? entry.tokens?.[index + 1]?.start ?? entry.end ?? token.start),
      }))
      : undefined;
    return { text: entry.text, start: round3(entry.start), end: entry.end === undefined ? undefined : round3(entry.end), tokens };
  });
  if (offsetSeconds !== 0) shift(lines, offsetSeconds);
  lines.push(...untimed.map((text) => ({ text })));
  return { version: LYRICS_DOC_VERSION, lines };
}

/** The offset tag moves every time in the document, clamped at zero like a real player. */
function shift(lines: LyricsLine[], delta: number) {
  for (const line of lines) {
    if (line.start !== undefined) line.start = round3(Math.max(0, line.start + delta));
    if (line.end !== undefined) line.end = round3(Math.max(0, line.end + delta));
    for (const token of line.tokens ?? []) {
      token.start = round3(Math.max(0, token.start + delta));
      token.end = round3(Math.max(0, token.end + delta));
    }
  }
}

export function docFromLines(lines: string[]): LyricsDoc {
  return {
    version: LYRICS_DOC_VERSION,
    lines: lines.map((line) => line.trim()).filter(Boolean).map((text) => ({ text })),
  };
}

/** A stored document, read back from its JSON string; null when the string is not one. */
export function parseLyricsJson(raw: string): LyricsDoc | null {
  try {
    return coerceLyricsDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Any lyrics text the studio has: a stored document, LRC, or plain lines — never throws. */
export function parseLyrics(raw: string): LyricsDoc {
  const text = raw.replace(/\r\n?/g, "\n");
  const trimmed = text.trim();
  if (!trimmed) return emptyLyricsDoc();
  if (trimmed.startsWith("{")) {
    const doc = parseLyricsJson(trimmed);
    if (doc) return doc;
  }
  if (LRC_LINE.test(text)) return parseLrc(text);
  return docFromLines(text.split("\n"));
}
