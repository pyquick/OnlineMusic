/**
 * The one key the studio's preferences live under, single-sourced so the systems that read and
 * write it — the page (playback, appearance) and the glass system (the dials) — cannot drift
 * apart. The blob is flat and each system only names its own fields.
 */
export const SETTINGS_STORAGE_KEY = "onlinemusic-settings";
