/**
 * The one key the studio's preferences live under, single-sourced so the systems that read and
 * write it — the page (playback, appearance) and the glass system (the dials) — cannot drift
 * apart. The blob is flat and each system only names its own fields.
 */
export const SETTINGS_STORAGE_KEY = "onlinemusic-settings";

/**
 * The session — where the listener was, and what was playing — lives under its own key: the
 * position changes on the media clock rather than on a settings edit, and a page that is merely
 * mid-song must not write the preferences blob from a timer.
 */
export const SESSION_STORAGE_KEY = "onlinemusic-session";

/** The five screens, single-sourced so a restored view cannot invent one. */
export const SESSION_VIEWS = ["studio", "projects", "albums", "library", "settings"] as const;
export type SessionView = (typeof SESSION_VIEWS)[number];

/**
 * What a refresh restores. The track is named by file name — the studio's identity everywhere —
 * so it can be resolved against the index stream however late its row arrives; `time` is seconds
 * into the track, and `playing` says whether the transport was running (a browser may still
 * refuse to resume it; the page then leaves the track loaded, paused, at `time`).
 */
export type StoredSession = {
  view: SessionView;
  track: string | null;
  time: number;
  playing: boolean;
  playOrder: string[];
  nowOpen: boolean;
  /** The fullscreen view's right-hand column: which side is showing and whether it is out. */
  nowPanel: "queue" | "lyrics";
  nowDrawer: boolean;
};

/** Reads a stored session defensively: fields are validated and a bad blob restores nothing. */
export function readStoredSession(data: unknown): StoredSession | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const view = (SESSION_VIEWS as readonly string[]).includes(record.view as string) ? (record.view as SessionView) : "studio";
  const time = typeof record.time === "number" && Number.isFinite(record.time) && record.time > 0 ? record.time : 0;
  return {
    view,
    track: typeof record.track === "string" && record.track.length > 0 ? record.track : null,
    time,
    playing: record.playing === true,
    playOrder: Array.isArray(record.playOrder)
      ? record.playOrder.filter((name): name is string => typeof name === "string" && name.length > 0)
      : [],
    nowOpen: record.nowOpen === true,
    nowPanel: record.nowPanel === "lyrics" ? "lyrics" : "queue",
    nowDrawer: record.nowDrawer === true,
  };
}
