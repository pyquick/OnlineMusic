import {
  LYRICS_DOC_VERSION,
  MAX_LYRICS_DOC_BYTES,
  MAX_LYRICS_LINES,
  MAX_LINE_TEXT_LENGTH,
  MAX_TOKENS_PER_LINE,
  MAX_TOKEN_TEXT_LENGTH,
  round3,
  type LyricsDoc,
  type LyricsLine,
  type LyricsToken,
} from "./types";

/**
 * The one shape-check both sides of the wire share: the route refuses a document this rejects,
 * and the client runs the lenient twin below on whatever it reads back, so a stored document can
 * never break the renderer however it got there.
 */
export class LyricsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LyricsValidationError";
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function timeValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new LyricsValidationError(`${field} must be a non-negative number`);
  }
  return round3(value);
}

function optionalTime(value: unknown, field: string): number | undefined {
  return value === undefined || value === null ? undefined : timeValue(value, field);
}

function textValue(value: unknown, field: string, maxLength: number, allowEmpty: boolean): string {
  if (typeof value !== "string") throw new LyricsValidationError(`${field} must be a string`);
  const text = value.trim();
  if (!allowEmpty && !text) throw new LyricsValidationError(`${field} is required`);
  if (text.length > maxLength) throw new LyricsValidationError(`${field} must be ${maxLength} characters or fewer`);
  return text;
}

function tokenValue(value: unknown, field: string): LyricsToken {
  if (!isRecord(value)) throw new LyricsValidationError(`${field} must be an object`);
  return {
    text: textValue(value.text, `${field}.text`, MAX_TOKEN_TEXT_LENGTH, true),
    start: timeValue(value.start, `${field}.start`),
    end: timeValue(value.end, `${field}.end`),
  };
}

function lineValue(value: unknown, index: number): LyricsLine {
  const field = `lines[${index}]`;
  if (!isRecord(value)) throw new LyricsValidationError(`${field} must be an object`);
  const line: LyricsLine = { text: textValue(value.text, `${field}.text`, MAX_LINE_TEXT_LENGTH, true) };
  const translation = value.translation === undefined || value.translation === null || value.translation === ""
    ? undefined
    : textValue(value.translation, `${field}.translation`, MAX_LINE_TEXT_LENGTH, true);
  if (translation !== undefined) line.translation = translation;
  const start = optionalTime(value.start, `${field}.start`);
  if (start !== undefined) line.start = start;
  const end = optionalTime(value.end, `${field}.end`);
  if (end !== undefined) line.end = end;
  if (value.tokens !== undefined) {
    if (!Array.isArray(value.tokens)) throw new LyricsValidationError(`${field}.tokens must be an array`);
    if (value.tokens.length > MAX_TOKENS_PER_LINE) {
      throw new LyricsValidationError(`${field}.tokens must contain ${MAX_TOKENS_PER_LINE} items or fewer`);
    }
    line.tokens = value.tokens.map((entry, tokenIndex) => tokenValue(entry, `${field}.tokens[${tokenIndex}]`));
  }
  return line;
}

/** Strict: throws with a message the API can hand back, and caps the serialized size it would store. */
export function validateLyricsDoc(value: unknown): LyricsDoc {
  if (!isRecord(value)) throw new LyricsValidationError("lyrics document must be an object");
  if (value.version !== undefined && value.version !== LYRICS_DOC_VERSION) {
    throw new LyricsValidationError(`unsupported lyrics version: ${String(value.version)}`);
  }
  if (!Array.isArray(value.lines)) throw new LyricsValidationError("lyrics document .lines must be an array");
  if (value.lines.length > MAX_LYRICS_LINES) {
    throw new LyricsValidationError(`lyrics document must contain ${MAX_LYRICS_LINES} lines or fewer`);
  }
  const doc: LyricsDoc = { version: LYRICS_DOC_VERSION, lines: value.lines.map(lineValue) };
  if (JSON.stringify(doc).length > MAX_LYRICS_DOC_BYTES) {
    throw new LyricsValidationError("lyrics document is too large");
  }
  return doc;
}

/** Lenient: never throws, drops what it cannot trust, and returns null when the shape is not a document at all. */
export function coerceLyricsDoc(value: unknown): LyricsDoc | null {
  if (!isRecord(value) || (value.version !== undefined && value.version !== LYRICS_DOC_VERSION)) return null;
  if (!Array.isArray(value.lines)) return null;
  const lines: LyricsLine[] = [];
  for (const entry of value.lines.slice(0, MAX_LYRICS_LINES)) {
    try {
      lines.push(lineValue(entry, lines.length));
    } catch {
      // One unreadable line must not cost the rest of the document.
    }
  }
  return { version: LYRICS_DOC_VERSION, lines };
}
