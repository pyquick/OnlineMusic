/**
 * The structured lyrics document both surfaces share: the playback renderer reads it, the editor
 * writes it, and the API stores it. Times are seconds with three decimals — millisecond precision
 * is what the tap workflow edits in — and only the text is required, so a plain-text import is
 * still a valid document; a line without `start` simply does not take part in synchronisation.
 */
export const LYRICS_DOC_VERSION = 1;
/** The stored document is a serialized JSON string inside the asset's metadata. */
export const MAX_LYRICS_DOC_BYTES = 1_000_000;
export const MAX_LYRICS_LINES = 5000;
export const MAX_TOKENS_PER_LINE = 500;
export const MAX_LINE_TEXT_LENGTH = 2000;
export const MAX_TOKEN_TEXT_LENGTH = 200;

export interface LyricsToken {
  text: string;
  /** Seconds. */
  start: number;
  /** Seconds. */
  end: number;
}

export interface LyricsLine {
  text: string;
  /** A translation bound to this line; it never takes part in the token timeline. */
  translation?: string;
  /** Seconds; absent while the line has no timing yet. */
  start?: number;
  end?: number;
  /** Word- or character-level timeline for the karaoke fill; absent for line-level lyrics. */
  tokens?: LyricsToken[];
}

export interface LyricsDoc {
  version: typeof LYRICS_DOC_VERSION;
  lines: LyricsLine[];
}

export function emptyLyricsDoc(): LyricsDoc {
  return { version: LYRICS_DOC_VERSION, lines: [] };
}

/** Seconds rounded to the millisecond the editor works in; kills the float dust of arithmetic. */
export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
