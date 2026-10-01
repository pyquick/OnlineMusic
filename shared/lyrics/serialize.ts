import type { LyricsDoc } from "./types";

/** The document as it is stored and exported: the full fidelity format, translations included. */
export function toJson(doc: LyricsDoc): string {
  return JSON.stringify(doc);
}

function stamp(seconds: number): string {
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}

/**
 * LRC out: one row per timed line, and a second row with the same stamp when the line carries a
 * translation — the bilingual convention most players read as two stacked lines. A document with
 * nothing timed exports as its plain text, which is still a usable .lrc source for the next import.
 */
export function toLrc(doc: LyricsDoc): string {
  const timed = doc.lines.filter((line) => typeof line.start === "number");
  if (timed.length === 0) return doc.lines.map((line) => line.text).join("\n");
  const rows: string[] = [];
  for (const line of timed) {
    const at = `[${stamp(line.start as number)}]`;
    rows.push(`${at}${line.text}`);
    if (line.translation) rows.push(`${at}${line.translation}`);
  }
  return rows.join("\n");
}
