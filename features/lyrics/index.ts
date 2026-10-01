/**
 * The feature's public surface for its neighbours — the now-playing view renders the words
 * through it, the page moves documents through it. The editor is deliberately not re-exported
 * here: it is loaded by its own entry (like AppearanceSettings) so this index stays light enough
 * for the now-playing chunk.
 */
export { default as PlaybackLyrics } from "./PlaybackLyrics";
export type { PlaybackLyricsProps } from "./PlaybackLyrics";
export { useLyricsSync } from "./useLyricsSync";
export type { LyricsSync } from "./useLyricsSync";
export { fetchLyricsDoc, saveLyricsDoc } from "./client";
