"use client";

import { CSSProperties, ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Disc3,
  FileAudio,
  FileVideo,
  FolderOpen,
  House,
  Layers3,
  Library,
  List,
  ListMusic,
  LockKeyhole,
  Maximize2,
  Menu,
  MessageSquareQuote,
  MoreHorizontal,
  Music2,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
  Settings,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  UserRound,
  Volume2,
  VolumeX,
  X,
} from "@/design-system/components/icons";
import { readEmbeddedTags } from "@/lib/embedded-tags";
import { startAmbientDrift } from "@/lib/ambientDrift";
import dynamic from "next/dynamic";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import type { Asset, IndexEntry } from "@/shared/types/media";
import { DEFAULT_APPEARANCE, GRADIENT_PRESETS, SOLID_PRESETS, tintChannels, type Appearance } from "@/features/appearance";
import { useGlassSystem } from "@/features/glass/useGlassSystem";
import { SESSION_STORAGE_KEY, readStoredSession, SETTINGS_STORAGE_KEY, type StoredSession } from "@/shared/utilities/settings";
import { RangeControl } from "@/design-system/components/RangeControl";
import { coverSrc } from "@/shared/utilities/media";
import { emptyLyricsDoc, parseLyrics, type LyricsDoc } from "@/shared/lyrics";
import { fetchLyricsDoc } from "@/features/lyrics";
import { SeekBar, WaveformTrack } from "@/features/player";
import { formatTime } from "@/shared/utilities/time";
import { ApiError, api, apiStream } from "@/infrastructure/api/client";
import { resolveApiUrl } from "@/infrastructure/api/base";
import BottomPill, { type PillItem } from "./bottom-pill";

/**
 * The Settings surface is only ever on screen after a click, so it is loaded on demand from its
 * own entry — the feature's index deliberately carries data only, so importing a default from
 * there would drag the whole view back into the first load.
 */
const AppearanceSettings = dynamic(() => import("@/features/appearance/AppearanceSettings"), { ssr: false });

/** The server-address card, shown with the appearance settings; also loaded on demand. */
const ServerSettings = dynamic(() => import("@/features/server/ServerSettings"), { ssr: false });

/** The precision editor is opened from the studio and covers the window; also loaded on demand. */
const ParametersScreen = dynamic(() => import("@/features/parameters/ParametersScreen"), { ssr: false });

/** The window-sized video player opens from a clip in the library; also loaded on demand. */
const VideoOverlay = dynamic(() => import("@/features/video").then((module) => module.VideoOverlay), { ssr: false });

/** The now-playing window is opened from the bar; loaded on demand like the other surfaces. */
const NowPlayingView = dynamic(() => import("@/features/now-playing").then((module) => module.NowPlayingView), { ssr: false });

/** The lyrics workspace is its own full-window surface, opened from the words; loaded on demand. */
const LyricsEditor = dynamic(() => import("@/features/lyrics/LyricsEditor"), { ssr: false });

const acceptedFormats =["MP3", "MP4", "M4A", "WAV", "FLAC", "OGG", "OGA", "OPUS", "AAC", "WMA", "WEBM", "MOV", "MKV", "AVI", "AIFF", "PNG", "JPG", "JPEG", "WEBP", "JSON"];
const acceptedExtensions = acceptedFormats.map((format) => `.${format.toLowerCase()}`).join(",");
const audioExtensions = new Set(["mp3", "m4a", "wav", "flac", "ogg", "oga", "opus", "aac", "wma", "aiff"]);
const videoExtensions = new Set(["mp4", "webm", "mov", "mkv", "avi"]);
const maxFileSize = 250 * 1024 * 1024;
/** How much of a track is buffered ahead of a click: enough to start on, not the whole song. */
const PREFETCH_SECONDS = 5;
/** How many entries at the top of a collection view are warmed when it opens. */
const LIST_PREFETCH_COUNT = 4;

function indexEntryToAsset(entry: IndexEntry): Asset {
  const mimeType = entry.mimeType || "application/octet-stream";
  const metadata: Record<string, unknown> = {};
  if (typeof entry.sizeBytes === "number") metadata.sizeBytes = entry.sizeBytes;
  if (entry.trackNo !== undefined) metadata.trackNo = entry.trackNo;
  if (entry.durationMs !== undefined) metadata.durationMs = entry.durationMs;
  if (entry.lyrics) metadata.lyrics = entry.lyrics;
  if (entry.mimeType) metadata.mimeType = entry.mimeType;
  if (entry.coverUrl) metadata.coverUrl = resolveApiUrl(entry.coverUrl);
  return {
    file: new File([], entry.name, { type: mimeType }),
    url: resolveApiUrl(entry.fileUrl || `/api/assets/${entry.id}/file`),
    kind: entry.mediaKind,
    title: entry.title || entry.name.replace(/\.[^.]+$/, ""),
    artist: entry.artist || "", album: entry.album || "", genre: entry.genre || "",
    metadata, apiId: entry.id,
  };
}

/** The first artwork found across a group of tracks. */
function albumCover(items: Asset[]) {
  for (const item of items) { const src = coverSrc(item); if (src) return src; }
  return "";
}

/** The songs of a listing, in the order they are shown: the order shuffle and list repeat walk. */
function audioNames(items: Asset[]) {
  return items.filter((item) => item.kind === "audio").map((item) => item.file.name);
}

/**
 * The colour an artwork is built around, as "r g b", or "" when it cannot be read. Read from a
 * thumbnail-sized draw so a forty-megapixel cover costs the same as a small one; the near-black and
 * near-white pixels of the image are discounted, because those are its paper and its ink, not its
 * colour, and an average that keeps them turns every cover into the same grey.
 */
async function artworkTint(src: string) {
  try {
    const image = new Image();
    // A cover from another origin must be CORS-clean before the pixels are read, or the read throws.
    image.crossOrigin = "use-credentials";
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 24;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "";
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0, g = 0, b = 0, weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const luma = (data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722) / 255;
      const share = 1.15 - Math.abs(luma - 0.5) * 2;
      r += data[i] * share; g += data[i + 1] * share; b += data[i + 2] * share; weight += share;
    }
    if (weight <= 0) return "";
    const channel = (value: number) => Math.round(Math.min(255, Math.max(0, value / weight)));
    return `${channel(r)} ${channel(g)} ${channel(b)}`;
  } catch {
    // A cover the canvas may not read, or one that never decodes: the view falls back to its own wash.
    return "";
  }
}

/** Safari paints a blank frame for a video that is merely preloaded; a media fragment makes it seek to the first frame. */
function firstFrameUrl(url: string) {
  if (!url || url.startsWith("blob:") || url.includes("#")) return url;
  return `${url}#t=0.001`;
}

/** Safari's play() can return undefined and rejects with AbortError when a newer load interrupts it. */
function safePlay(element: HTMLMediaElement | null | undefined) {
  if (!element) return;
  try {
    const result = element.play() as Promise<void> | undefined;
    if (result && typeof result.then === "function") void result.catch(() => { /* autoplay or an interrupted load */ });
  } catch { /* the element is not ready yet */ }
}

/** Rewinds to the poster frame; seeking before metadata is known throws in Safari. */
function showFirstFrame(video: HTMLVideoElement | null | undefined) {
  if (!video) return;
  try { video.currentTime = 0.001; } catch { /* metadata is not loaded yet */ }
}

/** iOS Safari reports a read-only volume, so this must never be a hard failure. */
function applyVolume(element: HTMLMediaElement | null | undefined, value: number) {
  if (!element) return;
  try { element.volume = Math.max(0, Math.min(1, value)); } catch { /* volume is not adjustable here */ }
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Assets loaded from the account carry an empty File placeholder, so fall back to the stored size. */
function assetSize(asset: Asset) {
  if (asset.file.size > 0) return asset.file.size;
  const stored = Number(asset.metadata.sizeBytes);
  return Number.isFinite(stored) ? stored : 0;
}

function fileKind(file: File): Asset["kind"] {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("video/") || videoExtensions.has(extension)) return "video";
  if (file.type.startsWith("image/")) return "image";
  if (file.name.toLowerCase().endsWith(".json")) return "project";
  if (file.type.startsWith("audio/") || audioExtensions.has(extension)) return "audio";
  return "audio";
}

/** Album order: embedded track numbers first (ascending), unnumbered tracks last, natural filename order as tie-break. */
function sortTracks(list: Asset[]) {
  const numberOf = (asset: Asset) => {
    const value = Number(asset.metadata.trackNo);
    return Number.isFinite(value) && value > 0 ? value : Number.POSITIVE_INFINITY;
  };
  return [...list].sort((a, b) => {
    const left = numberOf(a), right = numberOf(b);
    if (left !== right) return left - right;
    return a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
  });
}

/** Every screen the right-hand area can show, the sidebar and the small-screen pill sharing the list. */
type View = "studio" | "projects" | "albums" | "library" | "settings";
const viewTitles = { studio: "Home", projects: "My Projects", albums: "Albums", library: "Media Library", settings: "Settings" } as const;

function groupByAlbum(list: Asset[], audioOnly = false) {
  const groups: { album: string; items: Asset[] }[] = [];
  const loose: Asset[] = [];
  for (const item of list) {
    const album = item.album.trim();
    if (!album || (audioOnly && item.kind !== "audio")) { loose.push(item); continue; }
    const group = groups.find((entry) => entry.album.toLowerCase() === album.toLowerCase());
    if (group) group.items.push(item); else groups.push({ album, items: [item] });
  }
  for (const group of groups) group.items = sortTracks(group.items);
  return { groups, loose };
}

/** The artist credited on most tracks of an album. */
function albumArtist(items: Asset[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const artist = item.artist.trim();
    if (artist) counts.set(artist, (counts.get(artist) ?? 0) + 1);
  }
  let best = "", bestCount = 0;
  counts.forEach((count, artist) => { if (count > bestCount) { best = artist; bestCount = count; } });
  return best;
}

function trackLabel(item: Asset, index: number) {
  const value = Number(item.metadata.trackNo);
  return Number.isFinite(value) && value > 0 ? String(value) : String(index + 1);
}

/** The width below which the shell rearranges itself for a phone: navigation moves to the pill. */
const COMPACT_QUERY = "(max-width: 680px)";

/**
 * Whether the shell is in its small-screen layout. Starts false so the server and the first
 * client render agree, then syncs on mount — the CSS has its own guards for the one frame the
 * two can disagree in. The page owns this single answer and hands it down; two independent
 * listeners could disagree with each other for a frame in the middle of a resize.
 */
function useCompact() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return compact;
}

/** The playback and appearance fields of the stored blob; the glass dials are the glass system's
    own slice, read and written by features/glass through the same key. */
type StoredSettings = {
  gain: number;
  rate: number;
  volume: number;
  eq: number;
  fadeIn: number;
  fadeOut: number;
  appearance: Appearance;
};

function readStoredSettings(): StoredSettings {
  const defaults: StoredSettings = {
    gain: 72,
    rate: 100,
    volume: 72,
    eq: 0,
    fadeIn: 0,
    fadeOut: 0,
    appearance: DEFAULT_APPEARANCE,
  };
  if (typeof window === "undefined") return defaults;
  const stored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!stored) return defaults;
  try {
    const data = JSON.parse(stored) as Partial<StoredSettings> & { appearance?: Partial<Appearance> };
    return {
      gain: typeof data.gain === "number" ? data.gain : defaults.gain,
      rate: typeof data.rate === "number" ? data.rate : defaults.rate,
      volume: typeof data.volume === "number" ? data.volume : defaults.volume,
      eq: typeof data.eq === "number" ? data.eq : defaults.eq,
      fadeIn: typeof data.fadeIn === "number" ? data.fadeIn : defaults.fadeIn,
      fadeOut: typeof data.fadeOut === "number" ? data.fadeOut : defaults.fadeOut,
      appearance: data.appearance ? { ...DEFAULT_APPEARANCE, ...data.appearance } : defaults.appearance,
    };
  } catch {
    return defaults;
  }
}

type CachedUser = { email: string; name: string };

function readCachedUser(): CachedUser | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem("onlinemusic-user") || "null") as CachedUser | null;
    return value && typeof value.email === "string" && typeof value.name === "string" ? value : null;
  } catch {
    return null;
  }
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [playing, setPlaying] = useState(false);
  const [gain, setGain] = useState(72);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [rate, setRate] = useState(100);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<View>("studio");
  const [expandedAlbum, setExpandedAlbum] = useState<string | null>(null);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [user, setUser] = useState<CachedUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authError, setAuthError] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [volume, setVolume] = useState(72);
  const [queue, setQueue] = useState<string[]>([]);
  const [playOrder, setPlayOrder] = useState<string[]>([]);
  const [eq, setEq] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(false);
  const [projectMenu, setProjectMenu] = useState<string | null>(null);
  const [videoOverlay, setVideoOverlay] = useState<Asset | null>(null);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  /** The selected song's lyrics document: fetched once per asset, or parsed from its text. */
  const [lyricsDoc, setLyricsDoc] = useState<LyricsDoc | null>(null);
  /** Remembers what each asset's fetch answered, so switching songs does not refetch. */
  const lyricsCacheRef = useRef(new Map<string, LyricsDoc | null>());
  /** The standalone lyrics workspace, covering the window like the parameter editor does. */
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // The order the transport walks: shuffle picks a random other song, list repeat wraps at either
  // end. Both are offered only when the list holds more than one song.
  const [shuffleOn, setShuffleOn] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  const [nowOpen, setNowOpen] = useState(false);
  /** The fullscreen view's right-hand column, remembered with the session (see saveSession). */
  const [nowPanel, setNowPanel] = useState<"queue" | "lyrics">("queue");
  const [nowDrawer, setNowDrawer] = useState(false);
  /** Stable, so the view's key and gesture effects do not re-subscribe on every render. */
  const setNowDisclosure = useCallback((panel: "queue" | "lyrics", open: boolean) => { setNowPanel(panel); setNowDrawer(open); }, []);
  /** True for the length of the fall animation, so the view can leave before it unmounts. */
  const [nowClosing, setNowClosing] = useState(false);
  /** Held for the length of the play button's swell, so starting a track reads as an event. */
  const [playStarting, setPlayStarting] = useState(false);
  const wasPlaying = useRef(false);
  /** The artwork's colour, as "r g b", for the now-playing backdrop. Empty when there is no cover. */
  const [nowTint, setNowTint] = useState("");
  const [mediaError, setMediaError] = useState("");
  /** The tint the glass lays down, and the backdrop it sits on. Saved with everything else. */
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const compact = useCompact();
  /** True while the pill's bubble is up: the bar above it steps back and shrinks. */
  const [bubbleRaised, setBubbleRaised] = useState(false);
  /** False until the stored preferences have been applied, so a mount write cannot clobber them. */
  const [settingsReady, setSettingsReady] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  /** The Liquid Glass system: the dials, their storage, and every engine that turns them into
      pixels. Functional code touches the glass through this handle and the declarative DOM
      markers, never through the engines directly. */
  const glass = useGlassSystem(shellRef, appearance);
  /** The level the fullscreen speaker comes back to when it is unmuted; 72 is the dial's own default. */
  const lastGainRef = useRef(gain || 72);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const prefetchRef = useRef<HTMLMediaElement | null>(null);
  const prefetchTimer = useRef<number | null>(null);
  const listPrefetchRef = useRef<HTMLMediaElement[]>([]);
  const prefetchHostRef = useRef<HTMLDivElement>(null);
  const assetStreamRef = useRef<AbortController | null>(null);

  useLayoutEffect(() => {
    const cached = readCachedUser();
    if (cached) setUser(cached);
  }, []);

  useEffect(() => {
    let active = true;
    api.get<{ user?: CachedUser | null }>("/api/auth")
      .then((data) => { if (active) { setUser(data.user ?? null); setAuthReady(true); if (data.user) window.localStorage.setItem("onlinemusic-user", JSON.stringify(data.user)); else window.localStorage.removeItem("onlinemusic-user"); } })
      .catch(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);

  useLayoutEffect(() => {
    const current = readStoredSettings();
    setGain(current.gain);
    setRate(current.rate);
    setVolume(current.volume);
    setEq(current.eq);
    setFadeIn(current.fadeIn);
    setFadeOut(current.fadeOut);
    setAppearance(current.appearance);
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    // Waiting for both restores keeps the first write from overwriting stored values with defaults
    // (StrictMode runs these effects twice, so the order matters even on a single mount). The
    // glass slice rides along as an opaque patch, so this file never names its fields — which is
    // also why `glass.stored` is in the deps: a family override alone must still be saved.
    if (!settingsReady || !glass.ready) return;
    // The blob is merged rather than rebuilt: other systems (the server address) own fields too.
    const previous = (() => { try { return JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}") as Record<string, unknown>; } catch { return {} as Record<string, unknown>; } })();
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...previous, gain, rate, volume, eq, fadeIn, fadeOut, ...glass.stored, appearance }));
  }, [settingsReady, glass.ready, glass.stored, gain, rate, volume, eq, fadeIn, fadeOut, appearance]);

  /**
   * Every screen keeps the place it was scrolled to, like a tab. The studio scrolls the window,
   * so without this a view change leaves the next screen parked at the old offset — the bug the
   * user hit, where the other page arrived at exactly the same place. The position is recorded
   * continuously, against whichever view is showing, and restored before paint — a layout effect,
   * so the switch never flashes at the wrong offset. The first run is skipped: a reload should
   * keep the browser's own scroll restoration.
   */
  const scrollByView = useRef<Partial<Record<View, number>>>({});
  const shownView = useRef(view);
  shownView.current = view;
  useEffect(() => {
    const remember = () => { scrollByView.current[shownView.current] = window.scrollY; };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, []);
  const restored = useRef(false);
  /** The view the mount restore switched to: its first scroll effect must leave the browser's
      own reload restoration alone rather than scrolling to the remembered offset. */
  const ignoreScrollFor = useRef<View | null>(null);
  useLayoutEffect(() => {
    if (!restored.current) { restored.current = true; return; }
    if (ignoreScrollFor.current === view) { ignoreScrollFor.current = null; return; }
    window.scrollTo({ top: scrollByView.current[view] ?? 0 });
  }, [view]);

  /* ── The session ───────────────────────────────────────────────────────────
     What a refresh keeps: the screen, the track and its position, the transport's order and
     whether the fullscreen now-playing view was up. It is written on every change it names and
     on the media clock's own slower timer; the track is restored only once the index stream
     delivers its row, and never through playAsset — whose same-name branch would reset the very
     position being restored. */
  const sessionReady = useRef(false);
  /** The view the mount restore asked for, and the view of the first render. Writers stand down
      while the two disagree: hydration can run the saving effects before the restore's state
      update has rendered, and a stale view written then would clobber the session being restored
      (which is exactly what a refresh — and StrictMode's second effect run — would then read). */
  const restoreView = useRef<View | null>(null);
  const mountView = useRef(view);
  const pendingResume = useRef<{ name: string; time: number; playing: boolean } | null>(null);
  const pendingSeek = useRef<{ name: string; time: number; playing: boolean } | null>(null);
  /** True once the index stream has run to its end, so a missing track stops blocking the save. */
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  /** The latest session fields, for the writers that fire outside React's render. */
  const sessionState = useRef({ view, asset, playOrder, nowOpen, playing, nowPanel, nowDrawer });
  sessionState.current = { view, asset, playOrder, nowOpen, playing, nowPanel, nowDrawer };
  const lastSessionWrite = useRef(0);

  const saveSession = useCallback(() => {
    if (!sessionReady.current) return;
    const latest = sessionState.current;
    if (restoreView.current && latest.view !== restoreView.current) return;
    const audio = audioRef.current;
    const song = latest.asset?.kind === "audio" ? latest.asset : null;
    const time = song && audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
        view: latest.view,
        track: song?.file.name ?? null,
        time,
        playing: latest.playing,
        playOrder: latest.playOrder,
        nowOpen: latest.nowOpen,
        nowPanel: latest.nowPanel,
        nowDrawer: latest.nowDrawer,
      }));
    } catch { /* a full storage must not stop playback */ }
  }, []);

  // Before first paint, so the restored screen renders in the first frame. The transport is not
  // started here: the track resolves only when the index stream reaches its row.
  useLayoutEffect(() => {
    let session: StoredSession | null = null;
    try { session = readStoredSession(JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "null")); } catch { session = null; }
    sessionReady.current = true;
    if (!session) return;
    setPlayOrder(session.playOrder);
    if (session.nowOpen) setNowOpen(true);
    setNowPanel(session.nowPanel);
    setNowDrawer(session.nowDrawer);
    if (session.track) pendingResume.current = { name: session.track, time: session.time, playing: session.playing };
    if (session.view !== shownView.current) { ignoreScrollFor.current = session.view; restoreView.current = session.view; }
    setView(session.view);
  }, []);

  // Once a render shows any view but the mount's, the restore has landed — or the listener moved
  // on first — and the writers are free again.
  useEffect(() => {
    if (view !== mountView.current) restoreView.current = null;
  }, [view]);

  // Starting a track gets a slow swell on the play glyph; pausing just swaps the icon.
  useEffect(() => {
    if (playing && !wasPlaying.current) {
      setPlayStarting(true);
      wasPlaying.current = true;
      const timer = window.setTimeout(() => setPlayStarting(false), 900);
      return () => window.clearTimeout(timer);
    }
    wasPlaying.current = playing;
  }, [playing]);

  // The ambient drift is stepped, not animated: see lib/ambientDrift.ts for what the frames cost.
  useEffect(() => startAmbientDrift(), []);

  // Which input is driving focus: the shell carries `data-pointer` from a pointerdown until the
  // next keydown, and the stylesheet keeps every ring off while it does. CSS alone cannot tell —
  // a Mac with keyboard navigation on makes the browser call every focus :focus-visible — so a
  // click would otherwise leave the browser's blue box on the control it landed on.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const fromPointer = () => shell.setAttribute("data-pointer", "");
    const fromKeys = () => shell.removeAttribute("data-pointer");
    document.addEventListener("pointerdown", fromPointer, true);
    document.addEventListener("keydown", fromKeys, true);
    return () => {
      document.removeEventListener("pointerdown", fromPointer, true);
      document.removeEventListener("keydown", fromKeys, true);
    };
  }, []);

  /** Reads the newline-delimited index and appends each list entry as soon as its line arrives. */
  async function loadRemoteAssets() {
    if (!authReady) return;
    assetStreamRef.current?.abort();
    if (!user) { setAssets([]); pendingResume.current = null; return; }
    const controller = new AbortController();
    assetStreamRef.current = controller;
    const merge = (entries: IndexEntry[]) => {
      if (entries.length === 0) return;
      setAssets((current) => {
        const seen = new Set(current.map((item) => item.file.name));
        const added = entries.map(indexEntryToAsset).filter((item) => !seen.has(item.file.name));
        return added.length ? [...current, ...added] : current;
      });
    };
    try {
      const response = await apiStream("/api/assets?index=1", { signal: controller.signal });
      setAssets([]);
      const reader = response.body?.getReader();
      if (!reader) {
        // Older engines without a streaming fetch body: parse the same payload in one pass.
        for (const line of (await response.text()).split("\n")) if (line.trim()) merge([JSON.parse(line) as IndexEntry]);
        return;
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        const batch: IndexEntry[] = [];
        for (const line of lines) {
          if (!line.trim()) continue;
          try { batch.push(JSON.parse(line) as IndexEntry); } catch { /* skip an incomplete line */ }
        }
        merge(batch);
      }
      if (buffer.trim()) { try { merge([JSON.parse(buffer) as IndexEntry]); } catch { /* trailing partial line */ } }
    } catch { /* an aborted or interrupted stream keeps whatever rows already rendered */ }
    finally {
      // Only the stream that still owns the ref has finished; an aborted one hands over to its
      // successor, whose own end will flip this.
      if (assetStreamRef.current === controller) setAssetsLoaded(true);
    }
  }

  useEffect(() => { void loadRemoteAssets(); }, [user?.email, authReady]);

  // The saved track, resolved against the index stream as soon as its row arrives. A listener who
  // picked something first wins; a stream that ends without the track drops the restore instead
  // of blocking the session writers for good.
  useEffect(() => {
    const pending = pendingResume.current;
    if (!pending) return;
    if (sessionState.current.asset) { pendingResume.current = null; return; }
    const found = assets.find((item) => item.kind === "audio" && item.file.name === pending.name);
    if (found) {
      pendingResume.current = null;
      pendingSeek.current = pending;
      setAsset(found);
      return;
    }
    if (assetsLoaded) pendingResume.current = null;
  }, [assets, assetsLoaded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    if (asset?.kind === "audio") {
      // Assigning src already starts loading; calling load() again would abort and restart the fetch.
      audio.src = asset.url;
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
  }, [asset?.url, asset?.kind]);

  // The restored position: the src effect above has just reset currentTime, so the seek waits for
  // the track's own metadata, and the play effect below then starts it. A browser that refuses to
  // autoplay leaves the element loaded and paused exactly here — the agreed fallback.
  useEffect(() => {
    const audio = audioRef.current;
    const pending = pendingSeek.current;
    if (!audio || !pending || asset?.file.name !== pending.name) return;
    const apply = () => {
      if (pendingSeek.current !== pending) return;
      pendingSeek.current = null;
      const duration = audio.duration;
      const time = Number.isFinite(duration) && duration > 0 ? Math.min(pending.time, Math.max(0, duration - 0.1)) : pending.time;
      try { audio.currentTime = time; } catch { /* the source is gone again */ }
      if (pending.playing) setPlaying(true);
    };
    if (audio.readyState >= 1) { apply(); return; }
    audio.addEventListener("loadedmetadata", apply, { once: true });
    return () => audio.removeEventListener("loadedmetadata", apply);
  }, [asset?.file.name, asset?.url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const ended = () => {
      // The same walk the transport buttons use, so shuffle and list repeat govern the end of a
      // song too. Nothing to move on to leaves the player stopped, as it has always been.
      const next = trackAt(1);
      if (next) void playAsset(next, playOrder);
      else setPlaying(false);
    };
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("ended", ended);
    };
  }, [asset, playOrder, assets, shuffleOn, loopOn]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    try { audio.playbackRate = rate / 100; } catch { /* Safari rejects a rate change before metadata */ }
    applyVolume(audio, gain / 100);
  }, [rate, gain]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || asset?.kind !== "audio") return;
    if (playing) {
      // Switching tracks aborts the previous play() promise; that rejection must not stop the new track.
      void audio.play().catch((error: DOMException) => { if (error?.name !== "AbortError") setPlaying(false); });
    } else {
      audio.pause();
    }
  }, [playing, asset]);

  // Every change the session names is saved at once; the media clock writes on its own slower
  // timer. Skipped while a restore is pending — the track has not resolved yet, and writing now
  // would store a null track over the session being restored.
  useEffect(() => {
    if (pendingResume.current || !sessionReady.current) return;
    saveSession();
  }, [view, playOrder, nowOpen, playing, nowPanel, nowDrawer, asset?.file.name, saveSession]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      const now = Date.now();
      if (now - lastSessionWrite.current < 3000) return;
      lastSessionWrite.current = now;
      saveSession();
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", saveSession);
    audio.addEventListener("ended", saveSession);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", saveSession);
      audio.removeEventListener("ended", saveSession);
    };
  }, [saveSession]);

  // A tab being hidden or closed cannot wait for the next media event.
  useEffect(() => {
    const onHide = () => saveSession();
    const onVisibility = () => { if (document.visibilityState === "hidden") onHide(); };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [saveSession]);

  // On entering a collection view, warm the head of the first few songs so the top of the list plays instantly.
  // Videos are left to the hover hint: their read-ahead is large, so they are not pulled on sight.
  useEffect(() => {
    if (view === "studio") return;
    const pool = (view === "albums" ? albums.flatMap((entry) => entry.items) : listedAssets).filter((item) => item.kind === "audio");
    for (const item of pool.slice(0, LIST_PREFETCH_COUNT)) {
      const element = startHeadPrefetch(item);
      if (element) listPrefetchRef.current.push(element);
    }
  }, [view, assets, search]);

  // While an album or playlist is playing, keep the next track warm so switching is instant.
  useEffect(() => {
    if (!playing || playOrder.length === 0) return;
    const index = playOrder.indexOf(asset?.file.name ?? "");
    const next = index >= 0 ? assets.find((item) => item.file.name === playOrder[index + 1]) : undefined;
    if (next) prefetchAsset(next);
  }, [playing, playOrder, asset?.file.name, assets]);

  // The now-playing backdrop is the artwork's own colour. Read when the view opens and whenever the
  // song changes under it; a stale read is dropped rather than flashing the previous cover's wash.
  useEffect(() => {
    if (!nowOpen || !asset) { setNowTint(""); return; }
    const cover = coverSrc(asset);
    if (!cover) { setNowTint(""); return; }
    let live = true;
    void artworkTint(cover).then((tint) => { if (live) setNowTint(tint); });
    return () => { live = false; };
  }, [nowOpen, asset]);


  useEffect(() => {
    if (!videoOverlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const video = videoRef.current; if (!video) return;
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === " ") { event.preventDefault(); if (video.paused) void video.play(); else video.pause(); }
      if (event.key === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 5);
      if (event.key === "ArrowRight") video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 5);
      if (event.key.toLowerCase() === "j") video.currentTime = Math.max(0, video.currentTime - 10);
      if (event.key.toLowerCase() === "l") video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      if (event.key.toLowerCase() === "m") video.muted = !video.muted;
      if (event.key === "Escape") { video.pause(); setVideoPlaying(false); setVideoOverlay(null); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoOverlay]);

  /**
   * Space is the transport key: with the window focused it starts and stops the song, the way a
   * player's own space bar does. It is swallowed before the browser can scroll the page or press
   * whichever button happens to hold focus — the blue focus box a keypress paints on that button is
   * exactly what the user asked not to see, so the blur goes with it — and it stands down for text
   * fields, for the open dialogs, and for the video overlay, which runs its own space bar.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== " " && event.code !== "Space") || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      // A slider keeps its focus — space is not one of its keys — but a text field is typing, not transport.
      if (target instanceof HTMLInputElement && target.type !== "range") return;
      if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.isContentEditable) return;
      if (videoOverlay || modalOpen || authOpen || parametersOpen || lyricsEditorOpen) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (asset?.kind === "audio") setPlaying((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoOverlay, modalOpen, authOpen, parametersOpen, lyricsEditorOpen, asset]);

  async function playAsset(nextAsset: Asset, order?: string[]) {
    // A listener's choice outranks the restore still in flight.
    pendingResume.current = null;
    pendingSeek.current = null;
    // Shuffle and list repeat walk songs only: a clip in the listing is dropped here, at the one
    // point every listing feeds through, so no caller can leave a video in the order to be stepped to.
    const songs = new Set(assets.filter((item) => item.kind === "audio").map((item) => item.file.name));
    setPlayOrder(order ? order.filter((name) => songs.has(name)) : []);
    setMediaError("");
    if (nextAsset.kind === "audio" && nextAsset.file.name === asset?.file.name) { const audio = audioRef.current; if (audio) { try { audio.currentTime = 0; } catch { /* metadata not loaded yet */ } safePlay(audio); } }
    setAsset(nextAsset); setProjectMenu(null); setMetadataPanelOpen(false);
    if (nextAsset.kind === "audio") { setPlaying(true); return; }
    setPlaying(false);
    if (nextAsset.kind === "video") { setVideoOverlay(nextAsset); setVideoProgress(0); setVideoDuration(0); setVideoPlaying(true); window.setTimeout(() => safePlay(videoRef.current), 0); }
  }

  /** Waits for hover intent first, so sweeping the mouse across cards does not start any download. */
  function schedulePrefetch(item: Asset) {
    if (prefetchTimer.current) window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = window.setTimeout(() => { prefetchTimer.current = null; prefetchAsset(item); }, 250);
  }

  function cancelPrefetch() {
    if (prefetchTimer.current) { window.clearTimeout(prefetchTimer.current); prefetchTimer.current = null; }
  }

  /** Drops a prefetch hint; whatever it already buffered stays in the browser cache. */
  function stopPrefetch(element: HTMLMediaElement) {
    try { element.pause(); } catch { /* the element may not be playing */ }
    element.removeAttribute("src");
    element.load();
    element.remove();
  }

  /** Buffers just the head of a track into the browser cache and returns the element doing it. */
  function startHeadPrefetch(item: Asset) {
    if ((item.kind !== "audio" && item.kind !== "video") || item.file.name === asset?.file.name) return null;
    if (item.url.startsWith("blob:") || prefetchedRef.current.has(item.file.name)) return null;
    prefetchedRef.current.add(item.file.name);
    const element = document.createElement(item.kind === "video" ? "video" : "audio");
    element.preload = "auto";
    element.muted = true;
    // A media URL on another origin must be fetched with credentials so the glass can read its pixels.
    element.crossOrigin = "use-credentials";
    if (element instanceof HTMLVideoElement) { element.playsInline = true; element.setAttribute("playsinline", ""); }
    // Safari only buffers media elements that are in the document, so the hint lives in a hidden host.
    prefetchHostRef.current?.appendChild(element);
    element.src = item.url;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const buffered = element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0;
      // Stop once the head is buffered: enough to start on, not the whole track.
      if (buffered >= PREFETCH_SECONDS || Date.now() - started >= 8000) {
        window.clearInterval(timer);
        stopPrefetch(element);
        listPrefetchRef.current = listPrefetchRef.current.filter((entry) => entry !== element);
        if (prefetchRef.current === element) prefetchRef.current = null;
      }
    }, 50);
    return element;
  }

  /** Hovering a card hints its head; only one hover hint runs at a time. */
  function prefetchAsset(item: Asset) {
    const previous = prefetchRef.current;
    if (previous) { stopPrefetch(previous); prefetchRef.current = null; }
    const element = startHeadPrefetch(item);
    if (element) prefetchRef.current = element;
  }

  /** Switches what plays from the video overlay rail: another video stays in the overlay, a song returns to the studio player. */
  function playFromVideoOverlay(item: Asset) {
    if (item.kind === "video") { void playAsset(item); return; }
    if (item.kind !== "audio") return;
    videoRef.current?.pause();
    setVideoPlaying(false);
    setVideoOverlay(null);
    void playAsset(item, audioNames(playableAssets));
  }

  /** Plays an album from a given track and keeps advancing through it as tracks end. */
  function playAlbum(items: Asset[], startIndex: number) {
    const start = items[startIndex];
    if (!start || start.kind !== "audio") return;
    void playAsset(start, items.filter((item) => item.kind === "audio").map((item) => item.file.name));
  }

  async function openVideoProject() {
    const video = videoRef.current;
    if (video && document.pictureInPictureEnabled && !video.disablePictureInPicture) {
      try {
        // Safari exposes picture-in-picture through its own presentation-mode API.
        const legacy = video as HTMLVideoElement & { webkitSetPresentationMode?: (mode: string) => void };
        if (typeof legacy.webkitSetPresentationMode === "function") legacy.webkitSetPresentationMode("picture-in-picture");
        else await video.requestPictureInPicture();
      } catch { /* browser may require a user gesture */ }
    }
    if (videoOverlay) { setPlaying(false); setAsset(videoOverlay); setVideoOverlay(null); setView("studio"); }
  }

  function togglePlayback() {
    if (asset?.kind === "audio") setPlaying((current) => !current);
  }

  /** The fullscreen pill's speaker: silence, or back to the level that was in use a moment ago. */
  function toggleMute() {
    if (gain === 0) { setGain(lastGainRef.current); return; }
    lastGainRef.current = gain;
    setGain(0);
  }

  /**
   * The neighbouring song of the order the transport advertises — the playing order, else the songs
   * of the view — in the direction asked for. With shuffle on the next song is drawn at random from
   * the rest of the list; otherwise the walk is the list itself, wrapping only while list repeat is
   * on — so a finished queue stops where it ends, as it used to.
   */
  function trackAt(step: 1 | -1) {
    const names = queueNames;
    const current = names.indexOf(asset?.file.name ?? "");
    if (names.length === 0) return undefined;
    if (shuffleOn && step === 1) {
      const rest = names.filter((name) => name !== asset?.file.name);
      if (rest.length === 0) return undefined;
      return assets.find((item) => item.file.name === rest[Math.floor(Math.random() * rest.length)]);
    }
    let index = current + step;
    if (index < 0) index = loopOn ? names.length - 1 : -1;
    if (index >= names.length) index = loopOn ? 0 : -1;
    if (current < 0 || index < 0) return undefined;
    return assets.find((item) => item.file.name === names[index]);
  }

  function playTrack(step: 1 | -1) {
    const next = trackAt(step);
    if (next) void playAsset(next, queueNames);
  }

  /**
   * The tint and the backdrop, as the custom properties the stylesheet and the two glass engines
   * read back. A solid colour has to switch the image layer off as well, or the default gradient
   * would keep painting over it.
   */
  const appearanceStyle = useMemo(() => {
    const [r, g, b] = tintChannels(appearance.tint);
    const style: Record<string, string> = {
      "--glass-tint-r": String(r),
      "--glass-tint-g": String(g),
      "--glass-tint-b": String(b),
      "--shell-luma": String(appearance.shellLuma),
    };
    if (appearance.bgKind === "image" && appearance.bgImage) {
      style["--shell-bg-image"] = `url(${JSON.stringify(appearance.bgImage)})`;
      style["--shell-base"] = "#101216";
      style["--shell-scrim"] = appearance.bgDim > 0
        ? `linear-gradient(rgba(4,5,12,${(appearance.bgDim / 100).toFixed(3)}),rgba(4,5,12,${(appearance.bgDim / 100).toFixed(3)}))`
        : "linear-gradient(#0000,#0000)";
    } else if (appearance.bgKind === "gradient") {
      style["--shell-bg-image"] = GRADIENT_PRESETS.find((preset) => preset.id === appearance.bgGradient)?.css ?? GRADIENT_PRESETS[0].css;
    } else {
      style["--shell-base"] = SOLID_PRESETS.find((preset) => preset.id === appearance.bgPreset)?.color ?? "#f6f7fb";
      style["--shell-bg-image"] = "none";
    }
    return style as CSSProperties;
  }, [appearance]);

  function goTo(nextView: View) {
    setView(nextView);
    setSidebarOpen(false);
    setParametersOpen(false);
    setExpandedAlbum(null);
  }

  /**
   * The listings, derived rather than stored, and memoised on what they actually depend on.
   * `groupByAlbum` walks the whole library and `queueItems` looks each name up by scanning the
   * list, so both are O(n·m) — cheap on a handful of files and not cheap on a library of
   * hundreds, which is exactly the size this studio is built for. Recomputing them on every
   * render was the most expensive thing a keystroke or a slider move did.
   */
  const visibleAssets = useMemo(
    () => assets.filter((item) => !search || item.file.name.toLowerCase().includes(search.toLowerCase())),
    [assets, search],
  );
  const playableAssets = useMemo(() => assets.filter((item) => item.kind === "audio" || item.kind === "video"), [assets]);

  const listedAssets = view === "projects" ? assets : visibleAssets;
  const { groups: albumGroups, loose: looseAssets } = useMemo(() => groupByAlbum(listedAssets), [listedAssets]);
  const albums = useMemo(
    () => groupByAlbum(visibleAssets, true).groups.sort((a, b) => a.album.localeCompare(b.album)),
    [visibleAssets],
  );

  /** The navigation, as the pill's tabs: the sidebar's five screens, with the same live counts. */
  const pillItems = useMemo<PillItem[]>(() => [
    { id: "studio", label: "Home", icon: <House size={19} /> },
    { id: "projects", label: "Projects", icon: <Music2 size={19} />, badge: assets.length || undefined },
    { id: "albums", label: "Albums", icon: <Disc3 size={19} />, badge: albums.length || undefined },
    { id: "library", label: "Library", icon: <Library size={19} /> },
    { id: "settings", label: "Settings", icon: <Settings size={19} /> },
  ], [assets.length, albums.length]);

  /** What the transport walks and the queue list shows: the playing order, else the view's songs. */
  const queueNames = useMemo(() => (playOrder.length > 0 ? playOrder : audioNames(listedAssets)), [playOrder, listedAssets]);
  const queueItems = useMemo(() => {
    // One pass over the library with a name→asset map, rather than a scan of the whole list per name.
    const byName = new Map(assets.map((item) => [item.file.name, item]));
    return queueNames.map((name) => byName.get(name)).filter((item): item is Asset => Boolean(item));
  }, [queueNames, assets]);
  /** Shuffle and repeat are only worth offering once there is somewhere else to go. */
  const canStep = queueNames.length > 1;
  const barCover = asset ? coverSrc(asset) : "";
  /**
   * What the now-playing view is about: the song on the transport, if one is loaded. The view opens
   * from the bar's cover whether or not anything is playing — an empty studio's cover still opens it
   * onto the queue — and with no song the stage stays empty rather than borrowing a video's artwork.
   */
  const nowAudio = asset?.kind === "audio" ? asset : null;

  function renderProjectCard(item: Asset, index: number) {
    const name = item.title || item.file.name;
    const cover = coverSrc(item);
    return <button className="project-card" data-glass-edge="" key={item.file.name} onClick={() => { void playAsset(item, audioNames(listedAssets)); }} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}><div className={`project-art art-${index % 4} ${item.kind === "audio" ? "audio-art" : ""}`}>{cover ? <img src={cover} alt="" crossOrigin="use-credentials" loading="lazy" decoding="async" /> : item.kind === "video" ? <MediaThumb item={item} /> : item.kind === "image" ? <img src={item.url} alt="" crossOrigin="use-credentials" loading="lazy" decoding="async" /> : <Music2 size={28} />}</div><strong>{name}</strong><small>{formatBytes(assetSize(item))} · {item.kind}</small><span className="project-menu-wrap"><span className="project-menu-button" data-glass-edge="" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); setProjectMenu(projectMenu === item.file.name ? null : item.file.name); }}><MoreHorizontal size={17} /></span>{projectMenu === item.file.name && <span className="project-menu" data-glass-edge="" onClick={(event) => event.stopPropagation()}><span onClick={() => { setPlaying(false); setAsset(item); setMetadataPanelOpen(true); setProjectMenu(null); }}>Edit metadata</span></span>}</span></button>;
  }

  const waveform = useMemo(() => Array.from({ length: 78 }, (_, index) => 18 + ((index * 37) % 68)), []);

  /**
   * The selected song's lyrics: its stored document when it has one, else whatever its text
   * parses into (LRC keeps its timing; plain text stays untimed). The document never rides the
   * index stream, so it is fetched once per asset and remembered for the session.
   */
  useEffect(() => {
    const current = asset;
    if (!current || current.kind !== "audio") {
      setLyricsDoc(null);
      return;
    }
    const legacy = () => parseLyrics(typeof current.metadata.lyrics === "string" ? current.metadata.lyrics : "");
    if (!current.apiId) {
      setLyricsDoc(legacy());
      return;
    }
    const cached = lyricsCacheRef.current.get(current.apiId);
    if (cached !== undefined) {
      setLyricsDoc(cached ?? legacy());
      return;
    }
    const controller = new AbortController();
    const apiId = current.apiId;
    fetchLyricsDoc(apiId, controller.signal)
      .then((doc) => {
        lyricsCacheRef.current.set(apiId, doc);
        if (!controller.signal.aborted) setLyricsDoc(doc ?? legacy());
      })
      .catch(() => {
        // Offline or refused: the words the file came with are still worth reading.
        if (!controller.signal.aborted) setLyricsDoc(legacy());
      });
    return () => controller.abort();
  }, [asset?.apiId, asset?.kind, asset?.metadata.lyrics]);

  /** The bar's small sheet is a reading list, not the karaoke surface: plain lines only. */
  const lyricsPlain = useMemo(() => lyricsDoc?.lines.map((line) => line.text) ?? [], [lyricsDoc]);

  /** Opens the standalone workspace; the now view and the small sheet step aside for it. */
  function openLyricsEditor() {
    if (!asset || asset.kind !== "audio") return;
    if (nowOpen) setNowClosing(true);
    setLyricsOpen(false);
    setLyricsEditorOpen(true);
  }

  function openImport() {
    setError("");
    setModalOpen(true);
  }

  function chooseFile() {
    inputRef.current?.click();
  }

  async function persistImportedAsset(localAsset: Asset, reload = true) {
    try {
      const form = new FormData(); form.append("file", localAsset.file); form.append("mediaKind", localAsset.kind); form.append("metadata", JSON.stringify({ title: localAsset.title, artist: localAsset.artist, album: localAsset.album, genre: localAsset.genre, coverData: localAsset.metadata.coverData, trackNo: localAsset.metadata.trackNo, lyrics: localAsset.metadata.lyrics }));
      const payload = await api.post<{ asset?: { id?: string; fileUrl?: string } }>("/api/assets", form);
      if (payload.asset?.id) { setAsset((current) => current?.file === localAsset.file ? { ...current, apiId: payload.asset!.id, url: resolveApiUrl(payload.asset!.fileUrl || "") || current.url } : current); if (reload) await loadRemoteAssets(); return true; }
    } catch { /* keep local preview usable while offline */ }
    return false;
  }

  async function persistImportedAssets(imported: Asset[]) {
    const results = await Promise.all(imported.map((item) => persistImportedAsset(item, false)));
    // loadRemoteAssets() clears the list for guests, so only refresh for a signed-in account.
    if (user && results.some(Boolean)) await loadRemoteAssets();
  }

  function importError(file: File) {
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() : "";
    if (!extension || !acceptedFormats.includes(extension)) return `${file.name}: unsupported format`;
    if (file.size > maxFileSize) return `${file.name}: larger than 250 MB`;
    return null;
  }

  /** Applies a change to one asset across both the list and the selected asset. The match is by
      file name — the studio's identity everywhere — because a persisted import is re-streamed
      from the index as a fresh Asset whose File object is a new one, so the handle alone would
      miss it and the cards would keep the old text until a reload. */
  function patchAsset(file: File, patch: (item: Asset) => Asset) {
    setAssets((current) => current.map((item) => (item.file.name === file.name ? patch(item) : item)));
    setAsset((current) => (current && current.file.name === file.name ? patch(current) : current));
  }

  async function receiveFiles(files: File[]) {
    if (files.length === 0) return;
    const rejected = files.map(importError).filter((message): message is string => message !== null);
    const accepted = files.filter((file) => importError(file) === null);
    if (accepted.length === 0) {
      setError(rejected.join(" · "));
      return;
    }
    // List rows first — name, size and kind are known from the File handle, so the whole import
    // appears at once and the slower tag parsing fills each row in as it finishes.
    const imported: Asset[] = accepted.map((file) => ({
      file, url: URL.createObjectURL(file), kind: fileKind(file),
      title: file.name.replace(/\.[^.]+$/, ""), artist: "", album: "", genre: "",
      metadata: { sizeBytes: file.size, mimeType: file.type },
    }));
    setAssets((current) => {
      const names = new Set(imported.map((item) => item.file.name));
      return [...imported, ...current.filter((item) => !names.has(item.file.name))];
    });
    setAsset(imported[0]);
    setError(rejected.length > 0 ? `Imported ${imported.length} file${imported.length === 1 ? "" : "s"}. Skipped — ${rejected.join(" · ")}` : "");
    setSaved(false);
    setModalOpen(rejected.length > 0);
    setPlaying(false);
    // Tags resolve in whatever order the files parse, and each finished row updates on its own.
    const enriched = await Promise.all(imported.map(async (item) => {
      const tags = await readEmbeddedTags(item.file);
      const next: Asset = {
        ...item,
        title: tags.title || item.title,
        artist: tags.artist || item.artist,
        album: tags.album || item.album,
        genre: tags.genre || item.genre,
        metadata: {
          ...item.metadata,
          ...(tags.coverData ? { coverData: tags.coverData } : {}),
          ...(tags.trackNo ? { trackNo: tags.trackNo } : {}),
          ...(tags.lyrics ? { lyrics: tags.lyrics } : {}),
        },
      };
      patchAsset(item.file, () => next);
      return next;
    }));
    void persistImportedAssets(enriched);
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    void receiveFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void receiveFiles(Array.from(event.dataTransfer.files ?? []));
  }

  function addToQueue() {
    if (!asset) return;
    setQueue((current) => current.includes(asset.title || asset.file.name) ? current : [...current, asset.title || asset.file.name]);
  }

  function chooseCover() { coverInputRef.current?.click(); }

  function onCoverInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    const target = asset;
    if (!target) return;
    const reader = new FileReader();
    // Through patchAsset, not setAsset alone: the cards render from `assets`, so a new cover
    // must land on the strip and the project card the moment it is read.
    reader.onload = () => { patchAsset(target.file, (item) => ({ ...item, metadata: { ...item.metadata, coverData: String(reader.result) } })); setSaved(false); };
    reader.readAsDataURL(file);
  }

  function updateMetadata(field: "title" | "artist" | "album" | "genre", value: string) {
    // The list as well as the selection: a title typed here shows on the cards as it is typed.
    const current = asset;
    if (!current) return;
    patchAsset(current.file, (item) => ({ ...item, [field]: value }));
    setSaved(false);
  }

  useEffect(() => {
    if (!asset?.apiId) return;
    const timer = window.setTimeout(() => { void saveMetadata(); }, 500);
    return () => window.clearTimeout(timer);
  }, [asset?.title, asset?.artist, asset?.album, asset?.genre, asset?.metadata.coverData]);

  async function saveMetadata() {
    if (!asset) return;
    if (asset.apiId) {
      try {
        await api.patch(`/api/assets/${encodeURIComponent(asset.apiId)}`, {
          name: asset.file.name,
          metadata: { title: asset.title, artist: asset.artist, album: asset.album, genre: asset.genre, coverData: asset.metadata.coverData, gain, rate, eq, fadeIn, fadeOut },
        });
      } catch {
        // Keep local metadata changes when the API is unavailable.
      }
    }
    setSaved(true);
    window.localStorage.setItem(`onlinemusic-metadata-${asset.file.name}`, JSON.stringify({ title: asset.title, artist: asset.artist, album: asset.album, genre: asset.genre }));
  }

  return (
    <div ref={shellRef} className="studio-shell" data-bg={appearance.bgKind} data-theme={appearance.shellLuma < 0.5 ? "dark" : "light"} data-bubble={bubbleRaised ? "" : undefined} style={{ ...appearanceStyle, ...glass.style }}>
      {/* The backdrop: fixed, so it holds still under a scrolling page, and a real element, so the
          WebGL raster carries it. Everything else paints above it by document order. */}
      <div className="shell-bg" data-raster-fill aria-hidden="true" />
      {/* Colour behind the panes: a frosted surface only reads as glass when there is something behind it to blur. */}
      <div className="ambient" aria-hidden="true"><span className="ambient-orb orb-a" /><span className="ambient-orb orb-b" /></div>
      {!compact && <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`} data-glass-edge="" data-glass-scene="fixed-shell">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>onlineMusic</span></div>
        <nav className="nav-group"><p className="eyebrow">Listen</p><button className={`nav-item ${view === "studio" ? "active" : ""}`} onClick={() => goTo("studio")}><House size={17} /> Home</button><button className={`nav-item ${view === "projects" ? "active" : ""}`} onClick={() => goTo("projects")}><Music2 size={17} /> My Projects <span className="nav-count">{assets.length}</span></button><button className={`nav-item ${view === "albums" ? "active" : ""}`} onClick={() => goTo("albums")}><Disc3 size={17} /> Albums <span className="nav-count">{albums.length}</span></button><button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => goTo("library")}><Library size={17} /> Media Library</button></nav>
        <div className="sidebar-bottom"><button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => goTo("settings")}><Settings size={17} /> Settings</button><button className="profile profile-button" onClick={() => { setAuthError(""); setAuthOpen(true); }}><div className="avatar">{user?.name?.slice(0,2).toUpperCase() || "JL"}</div><div><strong>{user?.name || "Guest user"}</strong><small>{user ? user.email : "Sign in to sync"}</small></div></button></div>
      </aside>}

      <section className="content-area">
        <header className="topbar" data-glass-edge={compact ? undefined : ""} data-glass-scene="moving-page"><button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu"><Menu size={20} /></button><div className="breadcrumbs"><span>{viewTitles[view]}</span><ChevronDown size={14} /><strong>{view === "studio" ? "Media workspace" : view === "settings" ? "Glass, colour and background" : "Your collection"}</strong></div><div className="top-actions">{searchOpen && <input className="search-input" data-glass-edge="" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your music" />}<button className="icon-button" onClick={() => setSearchOpen((open) => !open)} aria-label="Search"><Search size={18} /></button><button className="icon-button" onClick={() => alert("Help center is available from your workspace.")} aria-label="Help"><CircleHelp size={18} /></button><button className="top-avatar top-avatar-button" onClick={() => setAuthOpen(true)}>{user?.name?.slice(0,2).toUpperCase() || "JL"}</button></div></header>
        <div className="page-content">
          {view === "settings" ? <><AppearanceSettings glass={glass.settings} onGlass={glass.update} appearance={appearance} onAppearance={(patch) => setAppearance((current) => ({ ...current, ...patch }))} onClose={() => goTo("studio")} /><ServerSettings /></> : view === "albums" ? <section className="collection-view"><div className="collection-heading"><h1>Albums</h1><button className="primary-button" onClick={openImport}><Plus size={17} /> Import media</button></div>{albums.length === 0 && <div className="project-grid"><div className="empty-assets" data-glass-edge="">No albums yet. Import songs that carry an album tag to build your collection.</div></div>}<div className="album-grid">{albums.map((entry) => { const key = entry.album.toLowerCase(); const cover = albumCover(entry.items); const expanded = expandedAlbum === key; return <button className={`album-card ${expanded ? "is-expanded" : ""}`} data-glass-edge="" key={key} onClick={() => setExpandedAlbum(expanded ? null : key)}><span className="album-card-art">{cover ? <img src={String(cover)} alt="" crossOrigin="use-credentials" /> : <Disc3 size={26} />}</span><strong>{entry.album}</strong><small>{albumArtist(entry.items) || "Unknown artist"} · {entry.items.length} {entry.items.length === 1 ? "track" : "tracks"}</small></button>; })}</div>{albums.filter((entry) => entry.album.toLowerCase() === expandedAlbum).map((entry) => { const cover = albumCover(entry.items); return <section className="album-detail" data-glass-edge="" key={entry.album.toLowerCase()}><header className="album-detail-head"><span className="album-cover">{cover ? <img src={String(cover)} alt="" crossOrigin="use-credentials" /> : <Disc3 size={18} />}</span><div><strong>{entry.album}</strong><small>{albumArtist(entry.items) || "Unknown artist"} · {entry.items.length} {entry.items.length === 1 ? "track" : "tracks"}</small></div><button className="primary-button" onClick={() => playAlbum(entry.items, 0)}><Play size={15} /> Play all</button><button className="icon-button" onClick={() => setExpandedAlbum(null)} aria-label="Collapse album"><X size={17} /></button></header><div className="track-list">{entry.items.map((item, index) => <button className={`track-row ${asset?.file.name === item.file.name ? "is-current" : ""}`} key={item.file.name} onClick={() => playAlbum(entry.items, index)} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}><span className="track-no">{trackLabel(item, index)}</span><span className="track-title">{item.title || item.file.name}</span><small>{formatBytes(assetSize(item))}</small></button>)}</div></section>; })}<button className="back-link" onClick={() => goTo("studio")}><ArrowLeft size={16} /> Back to studio</button></section> : view !== "studio" ? <section className="collection-view"><div className="collection-heading"><h1>{view === "projects" ? "My Projects" : "Media Library"}</h1><button className="primary-button" onClick={openImport}><Plus size={17} /> New project</button></div>{listedAssets.length === 0 && <div className="project-grid"><div className="empty-assets" data-glass-edge="">No saved media yet. Import a file to create your first project.</div></div>}{albumGroups.map((group) => { const cover = albumCover(group.items); return <section className="album-group" key={group.album.toLowerCase()}><header className="album-heading"><span className="album-cover">{cover ? <img src={String(cover)} alt="" crossOrigin="use-credentials" /> : <Disc3 size={18} />}</span><div><strong>{group.album}</strong><small>{group.items.length} {group.items.length === 1 ? "track" : "tracks"}</small></div></header><div className="project-grid">{group.items.map(renderProjectCard)}</div></section>; })}{looseAssets.length > 0 && <div className="project-grid">{looseAssets.map(renderProjectCard)}</div>}<button className="back-link" onClick={() => goTo("studio")}><ArrowLeft size={16} /> Back to studio</button></section> : <>
          <div className="welcome-row"><h1>Your media studio <span>✦</span></h1><div className="welcome-actions"><button className="ghost-button" data-glass-edge="" onClick={openImport}><Upload size={16} /> Import audio</button><button className="primary-button" onClick={openImport}><Plus size={17} /> New project</button></div></div>
          <div className="section-heading asset-heading"><h2>Your assets</h2><div className="asset-tools"><span className="asset-count">{assets.length} assets</span>{queue.length > 0 && <span className="asset-count">{queue.length} queued</span>}<button className="small-action" data-glass-edge="" onClick={openImport}><Plus size={14} /> Add</button></div></div>
          <div className="asset-strip">{assets.slice(0, 4).map((item) => <button className={`asset-card ${asset?.file.name === item.file.name ? "selected-asset" : ""}`} data-glass-edge="" key={item.file.name} onClick={() => { setPlaying(false); setAsset(item); }} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}><span className="asset-thumb imported">{asset?.file.name === item.file.name ? <Check size={18} /> : item.kind === "video" ? <FileVideo size={19} /> : <FileAudio size={19} />}</span><span className="asset-text"><strong>{item.title || item.file.name}</strong><small>{formatBytes(assetSize(item))} · {item.kind}</small></span></button>)}{assets.length === 0 && <div className="empty-assets" data-glass-edge="">No local media yet. Import a file to begin.</div>}</div>
          {asset?.kind === "audio" ? <section className="editor-layout"><div className="editor-panel panel" data-glass-edge=""><div className="panel-heading"><div><p className="eyebrow">Selected asset</p><h2>{asset.title || asset.file.name}</h2></div><div className="panel-heading-actions"><button className="toolbar-button" data-glass-edge="" onClick={openLyricsEditor}><Pencil size={14} /> Edit lyrics</button><button className="toolbar-button" data-glass-edge="" onClick={() => setParametersOpen(true)}><SlidersHorizontal size={14} /> Full parameter editor</button><button className="icon-button" aria-label="Close editor" onClick={() => { setPlaying(false); setAsset(null); }}><X size={17} /></button></div></div><div className="wave-editor"><div className="wave-toolbar"><span><Activity size={15} /> Waveform</span><button className="toolbar-button" data-glass-edge="" onClick={togglePlayback}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Preview"}</button></div><WaveformTrack media={audioRef} waveform={waveform} ariaLabel="Seek waveform" /></div><div className="controls-grid"><RangeControl label="Gain" value={gain} min={0} max={100} display={`${gain}%`} onChange={setGain} /><RangeControl label="Playback rate" value={rate} min={50} max={150} display={`${(rate / 100).toFixed(2)}x`} onChange={setRate} /></div><div className="advanced-row"><button className="toolbar-button" data-glass-edge="" onClick={() => setShowAdvanced((open) => !open)}><SlidersHorizontal size={14} /> {showAdvanced ? "Hide sound controls" : "More sound controls"}</button>{showAdvanced && <RangeControl label="Tone / EQ" value={eq} min={-100} max={100} display={`${eq > 0 ? "+" : ""}${eq}`} onChange={setEq} />}</div><button className="queue-add" data-glass-edge="" onClick={addToQueue}><ListMusic size={14} /> Add to queue</button></div><aside className="details-column"><div className="panel metadata-panel" data-glass-edge=""><div className="panel-title"><SlidersHorizontal size={16} /><h3>Metadata</h3></div>{(["title", "artist", "album", "genre"] as const).map((field) => <label key={field}>{field}<input data-glass-edge="" value={asset[field]} placeholder={`Add ${field}`} onChange={(event) => updateMetadata(field, event.target.value)} /></label>)}<button className="save-button" onClick={saveMetadata}>{saved ? "Saved" : "Save metadata"}</button></div></aside></section> : <section className="empty-editor panel" data-glass-edge=""><div className="empty-icon"><FolderOpen size={22} /></div><div><h2>Select an asset to edit</h2></div><button className="small-action" data-glass-edge="" onClick={openImport}><Plus size={14} /> Import media</button></section>}
          </>}
        </div>
      </section>
      {parametersOpen && asset && <ParametersScreen
        title={asset.title || asset.file.name}
        waveform={waveform}
        media={audioRef}
        playing={playing}
        saved={saved}
        rate={rate}
        volume={volume}
        gain={gain}
        eq={eq}
        fadeIn={fadeIn}
        fadeOut={fadeOut}
        onRate={setRate}
        onVolume={(value) => { setVolume(value); if (audioRef.current) audioRef.current.volume = value / 100; }}
        onGain={setGain}
        onEq={setEq}
        onFadeIn={setFadeIn}
        onFadeOut={setFadeOut}
        onTogglePlayback={togglePlayback}
        onSave={saveMetadata}
        onClose={() => setParametersOpen(false)}
      />}

      {view === "projects" && metadataPanelOpen && asset && <><aside className="metadata-float" data-glass-edge="" data-glass-scene="moving-page"><div className="metadata-float-header"><div><p className="eyebrow">Project metadata</p><h2>{asset.title || asset.file.name}</h2></div><button className="icon-button" onClick={() => setMetadataPanelOpen(false)}><X size={17} /></button></div>{(["title", "artist", "album", "genre"] as const).map((field) => <label key={field}>{field}<input data-glass-edge="" value={asset[field]} placeholder={`Add ${field}`} onChange={(event) => updateMetadata(field, event.target.value)} /></label>)}<button className="cover-button" data-glass-edge="" onClick={chooseCover}><Upload size={14} /> {coverSrc(asset) ? "Change cover image" : "Add cover image"}</button></aside><input ref={coverInputRef} type="file" accept="image/*" onChange={onCoverInput} hidden /></>}

      {nowOpen && <NowPlayingView
        track={nowAudio}
        cover={barCover}
        lyrics={lyricsDoc}
        queue={queueItems}
        queueNames={queueNames}
        playing={playing}
        playStarting={playStarting}
        gain={gain}
        canStep={canStep}
        shuffleOn={shuffleOn}
        loopOn={loopOn}
        tint={nowTint}
        closing={nowClosing}
        compact={compact}
        panel={nowPanel}
        drawer={nowDrawer}
        media={audioRef}
        onDisclosure={setNowDisclosure}
        onClose={() => setNowClosing(true)}
        onClosed={() => { setNowOpen(false); setNowClosing(false); }}
        onTogglePlayback={togglePlayback}
        onToggleMute={toggleMute}
        onGain={setGain}
        onStep={playTrack}
        onToggleShuffle={() => setShuffleOn((on) => !on)}
        onToggleLoop={() => setLoopOn((on) => !on)}
        onPick={(item) => { void playAsset(item, queueNames); }}
      />}

      {lyricsEditorOpen && asset && <LyricsEditor
        asset={asset}
        doc={lyricsDoc ?? emptyLyricsDoc()}
        media={audioRef}
        playing={playing}
        onTogglePlayback={togglePlayback}
        onSaved={(doc) => {
          // The playback page reads this state, so a saved document is live the moment it lands.
          setLyricsDoc(doc);
          if (asset.apiId) lyricsCacheRef.current.set(asset.apiId, doc);
        }}
        onClose={() => setLyricsEditorOpen(false)}
      />}

      {videoOverlay && <VideoOverlay
        item={videoOverlay}
        media={videoRef}
        playing={videoPlaying}
        progress={videoProgress}
        duration={videoDuration}
        playable={playableAssets}
        user={user}
        compact={compact}
        onProgress={setVideoProgress}
        onDuration={setVideoDuration}
        onPlayingChange={setVideoPlaying}
        onSelect={playFromVideoOverlay}
        onHoverItem={schedulePrefetch}
        onLeaveItem={cancelPrefetch}
        onRequestAuth={() => { setAuthError(""); setAuthOpen(true); }}
        onClose={() => { videoRef.current?.pause(); setVideoPlaying(false); setVideoOverlay(null); }}
      />}

      <audio ref={audioRef} crossOrigin="use-credentials" preload="metadata" onError={(event) => { const element = event.currentTarget; if (asset?.kind !== "audio" || !element.getAttribute("src")) return; setMediaError("This browser cannot decode this file"); }} />
      <div ref={prefetchHostRef} className="prefetch-host" aria-hidden="true" />

      {lyricsOpen && <aside className="glass-panel lyrics-panel" data-glass-edge="" data-glass-scene="moving-page" aria-label="Lyrics"><header className="glass-panel-head"><div><p className="eyebrow">Lyrics</p><h3>{asset?.title || "Not Playing"}</h3></div><button className="icon-button" onClick={() => setLyricsOpen(false)} aria-label="Close lyrics"><X size={16} /></button></header>{lyricsPlain.length > 0 ? <div className="lyrics-body">{lyricsPlain.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div> : <p className="glass-empty">No lyrics found. Lyrics stored in the file&apos;s tags appear here after import.</p>}</aside>}

      {projectsOpen && <aside className="glass-panel projects-panel" data-glass-edge="" data-glass-scene="moving-page" aria-label="Projects"><header className="glass-panel-head"><div><p className="eyebrow">Projects</p><h3>{assets.length} item{assets.length === 1 ? "" : "s"}{queue.length > 0 ? ` · ${queue.length} queued` : ""}</h3></div><button className="icon-button" onClick={() => setProjectsOpen(false)} aria-label="Close projects"><X size={16} /></button></header><div className="project-list">{queue.length > 0 && <section className="project-list-group"><p className="eyebrow">Queue</p>{queue.map((name) => <span className="project-list-row is-queued" key={`queued-${name}`}><ListMusic size={14} /><span className="project-list-name">{name}</span></span>)}</section>}<section className="project-list-group"><p className="eyebrow">Media</p>{assets.map((item) => <button className={`project-list-row ${asset?.file.name === item.file.name ? "is-current" : ""}`} key={item.file.name} onClick={() => { void playAsset(item); }} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}>{item.kind === "video" ? <FileVideo size={14} /> : item.kind === "audio" ? <Music2 size={14} /> : <Layers3 size={14} />}<span className="project-list-name">{item.title || item.file.name}</span><small>{formatBytes(assetSize(item))}</small></button>)}{assets.length === 0 && <p className="glass-empty">Nothing imported yet.</p>}</section></div></aside>}

      {compact && !videoOverlay && <BottomPill items={pillItems} current={view} onSelect={(id) => goTo(id as View)} onRaiseChange={setBubbleRaised} />}

      {!videoOverlay && <div className={`player glass-bar ${asset?.kind === "audio" && playing ? "audio-playing" : ""}`} data-glass-edge="" data-glass-scene="fixed-shell"><div className="now-playing"><button className="mini-cover-button" onClick={() => setNowOpen(true)} aria-label="Open now playing" title="Now playing"><span className={`mini-cover ${playing && asset?.kind === "audio" ? "is-playing" : ""}`}>{barCover ? <img src={barCover} alt="" crossOrigin="use-credentials" /> : asset?.kind === "video" ? <FileVideo size={16} /> : <Music2 size={16} />}<span className="mini-cover-expand" aria-hidden="true"><Maximize2 size={13} /></span></span></button><div className="now-playing-copy"><strong className={asset && (asset.title || asset.file.name).length > 28 ? "is-long-title" : ""}><span>{asset?.title || "No asset selected"}</span></strong><small className={mediaError ? "is-error" : ""}>{mediaError || (asset ? `${asset.kind} · local preview` : "Import something to begin")}</small></div></div><div className="player-controls">{canStep && <button className={`transport-extra ${shuffleOn ? "is-on" : ""}`} onClick={() => setShuffleOn((on) => !on)} aria-label="Shuffle" aria-pressed={shuffleOn} title="Shuffle"><Shuffle size={15} /></button>}<button className="icon-button transport-step" onClick={() => playTrack(-1)} disabled={!canStep} aria-label="Previous song" title="Previous"><SkipBack size={24} /></button><button className={`player-button ${playStarting ? "is-starting" : ""}`} onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"} disabled={!asset || asset.kind !== "audio"}>{playing ? <PauseGlyph size={36} /> : <PlayGlyph size={36} />}</button><button className="icon-button transport-step" onClick={() => playTrack(1)} disabled={!canStep} aria-label="Next song" title="Next"><SkipForward size={24} /></button>{canStep && <button className={`transport-extra ${loopOn ? "is-on" : ""}`} onClick={() => setLoopOn((on) => !on)} aria-label="Repeat list" aria-pressed={loopOn} title="Repeat list"><Repeat size={15} /></button>}<SeekBar media={audioRef} /></div><div className={`player-actions bar-cluster ${volumeOpen ? "is-volume-open" : ""}`}><button className={`glass-button bar-tool ${lyricsOpen ? "is-active" : ""}`} data-glass-edge="1" data-glass-scene="nested-host" onClick={() => { setLyricsOpen((open) => !open); setProjectsOpen(false); }} aria-label="Lyrics" title="Lyrics"><MessageSquareQuote size={17} /></button><button className={`glass-button bar-tool ${projectsOpen ? "is-active" : ""}`} data-glass-edge="1" data-glass-scene="nested-host" onClick={() => { setProjectsOpen((open) => !open); setLyricsOpen(false); }} aria-label="Projects" title="Projects"><List size={17} /></button><div className={`volume-cluster ${volumeOpen ? "is-open" : ""}`}><span className="volume-slider"><input type="range" min="0" max="100" value={gain} style={{ "--seek": `${gain}%` } as CSSProperties} tabIndex={volumeOpen ? 0 : -1} aria-hidden={!volumeOpen} onChange={(event) => setGain(Number(event.target.value))} aria-label="Volume" /></span><button className={`glass-button ${volumeOpen ? "is-active" : ""}`} data-glass-edge="1" data-glass-scene="nested-host" onClick={() => setVolumeOpen((open) => !open)} aria-label="Volume" title="Volume">{gain === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button></div></div></div>}


      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAuthOpen(false)}><div className="auth-modal" data-glass-edge="" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow">Local account</p><h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2><p>Your account stays on this device. No external service required.</p></div><button className="icon-button" onClick={() => setAuthOpen(false)}><X size={18} /></button></div>{user ? <><div className="account-badge"><UserRound size={17} /> Signed in as {user.email}</div><button className="save-button" onClick={async () => { await api.delete("/api/auth").catch(() => { /* signing out locally either way */ }); setUser(null); window.localStorage.removeItem("onlinemusic-user"); setAuthOpen(false); }}>Sign out</button></> : <form className="auth-form" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const email = String(data.get("email") || "").trim().toLowerCase(); const password = String(data.get("password") || ""); const name = String(data.get("name") || email.split("@")[0] || "User"); setAuthError(""); try { const payload = await api.post<{ user: { email: string; name: string } }>("/api/auth", { mode: authMode, email, password, name }); setUser(payload.user); window.localStorage.setItem("onlinemusic-user", JSON.stringify(payload.user)); setAuthOpen(false); } catch (error) { setAuthError(error instanceof ApiError && !error.isNetwork ? error.message : "Could not reach the server — try again in a moment."); } }}><div className="auth-tabs"><button type="button" data-glass-edge="" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Log in</button><button type="button" data-glass-edge="" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Register</button></div>{authMode === "register" && <label>Name<input data-glass-edge="" name="name" placeholder="Your name" /></label>}<label>Email<input data-glass-edge="" name="email" type="email" required placeholder="you@example.com" /></label><label>Password<input data-glass-edge="" name="password" type="password" required minLength={6} placeholder="At least 6 characters" /></label>{authError && <p className="error-message">{authError}</p>}<button className="primary-button auth-submit" type="submit"><LockKeyhole size={15} /> {authMode === "login" ? "Log in" : "Create account"}</button></form>}</div></div>}

      {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}><div className="upload-modal" data-glass-edge="" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow">Local import</p><h2>Bring media into the studio</h2><p>Files stay in this browser session until you choose to remove them.</p></div><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close upload dialog"><X size={18} /></button></div><div className={`dropzone ${dragging ? "dragging" : ""}`} data-glass-edge="" onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={chooseFile}><div className="drop-icon"><Upload size={23} /></div><h3>Drop audio or video here</h3><p>or <span>browse files</span> from your computer — pick several at once to import a full album</p><small>Maximum file size: 250 MB</small></div>{error && <p className="error-message">{error}</p>}<div className="format-list"><strong>Accepted formats</strong><div>{acceptedFormats.map((format) => <span key={format}>{format}</span>)}</div></div><input ref={inputRef} type="file" accept={acceptedExtensions} onChange={onInput} multiple hidden /></div></div>}
    </div>
  );
}



/**
 * Video card artwork: the first frame is the poster, and the clip plays only while the pointer is over
 * the thumbnail. The element is not created until the card is near the viewport, so a library of videos
 * never pulls every file at once, and a codec this browser cannot decode degrades to a labelled tile.
 */
function MediaThumb({ item }: { item: Asset }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "240px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return <span className="media-thumb" ref={hostRef}
    onPointerEnter={() => safePlay(videoRef.current)}
    onPointerLeave={() => { const video = videoRef.current; if (video) { video.pause(); showFirstFrame(video); } }}
  >
    {visible && !failed && <video ref={videoRef} src={firstFrameUrl(item.url)} crossOrigin="use-credentials" muted loop playsInline preload="metadata" onLoadedMetadata={(event) => showFirstFrame(event.currentTarget)} onError={() => setFailed(true)} />}
    {visible && failed && <span className="thumb-fallback"><FileVideo size={20} /><small>Preview unavailable in this browser</small></span>}
  </span>;
}

