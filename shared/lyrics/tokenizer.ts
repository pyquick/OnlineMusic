import { round3, type LyricsToken } from "./types";

/**
 * The automatic first cut: split a line into singable tokens and spread the line's own span over
 * them. It is a heuristic on purpose — the tap workflow (Enter at the playhead) is the precise
 * path, and this exists so that path has something to refine rather than starting from nothing.
 *
 * CJK text splits per character, Latin text per word, and punctuation rides the token it closes.
 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
/**
 * What is *not* one of these is a word character. Spelling the punctuation out instead of using
 * unicode property escapes keeps every other script (Cyrillic, Greek, accented Latin) on the word
 * path while the project still compiles for es5, which has no `u`-flag classes.
 */
const PUNCTUATION = /[.,!?;:()\[\]{}"'“”‘’…—–·、。！？；：（）【】《》〈〉「」『』~@#$%^&*+=|\\/<>_，．]/;

function isWordChar(char: string): boolean {
  return !/\s/.test(char) && !CJK.test(char) && !PUNCTUATION.test(char);
}

export function tokenizeText(text: string): string[] {
  const tokens: string[] = [];
  let buffer = "";
  let pending = "";
  const flush = () => {
    if (buffer || pending) {
      tokens.push(pending + buffer);
      buffer = "";
      pending = "";
    }
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    if (CJK.test(char)) {
      flush();
      if (pending) {
        tokens.push(pending + char);
        pending = "";
      } else tokens.push(char);
      continue;
    }
    if (isWordChar(char)) {
      if (!buffer && pending) {
        buffer = pending;
        pending = "";
      }
      buffer += char;
      continue;
    }
    // Punctuation: it closes the word just built, else the token before it, else it waits for
    // the word it opens ("Hello is one token).
    if (buffer) buffer += char;
    else if (tokens.length > 0) tokens[tokens.length - 1] += char;
    else pending += char;
  }
  flush();
  return tokens;
}

/** How much of the line's span a token earns: a CJK glyph is one syllable, a word its length. */
function weightOf(token: string): number {
  let letters = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (CJK.test(char) || isWordChar(char)) letters += 1;
  }
  return Math.max(0.5, letters);
}

export function tokenizeLine(text: string, start: number, end: number): LyricsToken[] {
  const parts = tokenizeText(text);
  if (parts.length === 0) return [];
  const span = Math.max(0, end - start);
  const weights = parts.map(weightOf);
  const total = weights.reduce((sum, weight) => sum + weight, 0) || parts.length;
  const tokens: LyricsToken[] = [];
  let consumed = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const from = round3(start + (span * consumed) / total);
    consumed += weights[index];
    const to = index === parts.length - 1 ? round3(end) : round3(start + (span * consumed) / total);
    tokens.push({ text: parts[index], start: from, end: Math.max(from, to) });
  }
  return tokens;
}
