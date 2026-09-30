"use client";

import { CSSProperties, ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Disc3,
  FileAudio,
  FileVideo,
  FolderOpen,
  Headphones,
  Home as House,
  Layers3,
  Library,
  List,
  ListMusic,
  Maximize2,
  Menu,
  MessageSquareQuote,
  MoreHorizontal,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Search,
  Settings,
  Shuffle,
  UserRound,
  LockKeyhole,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Upload,
  Video,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { readEmbeddedTags } from "@/lib/embedded-tags";
import { attachGlassEdge, MAX_EDGE_OFFSET, MAX_BAND_PX } from "@/lib/glassEdge";
import { attachGlassWebgl, type GlassWebglHandle } from "@/lib/glassWebgl";
import { setAutoShade, startInkSampler, touchScene } from "@/lib/inkSampler";
import dynamic from "next/dynamic";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import type { Asset, IndexEntry } from "@/shared/types/media";
import { BAND_PERCENT_TO_PX, DEFAULT_APPEARANCE, DEFAULT_GLASS_BLUR, DEFAULT_GLASS_CLARITY, DEFAULT_GLASS_EDGE, DEFAULT_GLASS_RADIUS, DEFAULT_GLASS_REFRACTION, GRADIENT_PRESETS, MAX_GLASS_BLUR, SOLID_PRESETS, tintChannels, type Appearance } from "@/features/appearance";
import { RangeControl } from "@/design-system/components/RangeControl";
import BottomPill, { type PillItem } from "./bottom-pill";

/**
 * The Settings surface is only ever on screen after a click, so it is loaded on demand from its
 * own entry — the feature's index deliberately carries data only, so importing a default from
 * there would drag the whole view back into the first load.
 */
const AppearanceSettings = dynamic(() => import("@/features/appearance/AppearanceSettings"), { ssr: false });

/** The precision editor is opened from the studio and covers the window; also loaded on demand. */
const ParametersScreen = dynamic(() => import("@/features/parameters/ParametersScreen"), { ssr: false });

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
  if (entry.coverUrl) metadata.coverUrl = entry.coverUrl;
  return {
    file: new File([], entry.name, { type: mimeType }),
    url: entry.fileUrl || `/api/assets/${entry.id}/file`,
    kind: entry.mediaKind,
    title: entry.title || entry.name.replace(/\.[^.]+$/, ""),
    artist: entry.artist || "", album: entry.album || "", genre: entry.genre || "",
    metadata, apiId: entry.id,
  };
}

/** Artwork for a card: an inline cover for local imports, a lazily fetched cover URL for stored assets. */
function coverSrc(item: Asset) {
  const value = item.metadata.coverData || item.metadata.coverUrl;
  return typeof value === "string" && value ? value : "";
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
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [gain, setGain] = useState(72);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [rate, setRate] = useState(100);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<View>("studio");
  const [expandedAlbum, setExpandedAlbum] = useState<string | null>(null);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
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
  const [videoControlsVisible, setVideoControlsVisible] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  // The order the transport walks: shuffle picks a random other song, list repeat wraps at either
  // end. Both are offered only when the list holds more than one song.
  const [shuffleOn, setShuffleOn] = useState(false);
  const [loopOn, setLoopOn] = useState(false);
  const [nowOpen, setNowOpen] = useState(false);
  /** Which right-hand panel the now-playing view shows: the songs that follow, or the lyrics. */
  const [nowPanel, setNowPanel] = useState<"queue" | "lyrics">("queue");
  /**
   * The right column is the corner switch's disclosure: the switch holding focus is what keeps the
   * panel open, and the moment focus leaves it the column gives its width back to the stage — which
   * is what puts the transport back in the middle of the window. The lit disc belongs to that held
   * state and goes with it, so a view nobody is pointing at shows two plain icons and no selection
   * at all — a click on the empty glass then leaves nothing behind, neither panel nor highlight.
   */
  const [nowDrawer, setNowDrawer] = useState(false);
  /** True for the length of the fall animation, so the view can leave before it unmounts. */
  const [nowClosing, setNowClosing] = useState(false);
  /** Held for the length of the play button's swell, so starting a track reads as an event. */
  const [playStarting, setPlayStarting] = useState(false);
  const wasPlaying = useRef(false);
  /** Live progress of the small screen's lyrics gesture, 0 at rest and 1 fully open. */
  const [nowReveal, setNowReveal] = useState(0);
  const [nowAxis, setNowAxis] = useState<"x" | "y" | null>(null);
  /** The artwork's colour, as "r g b", for the now-playing backdrop. Empty when there is no cover. */
  const [nowTint, setNowTint] = useState("");
  const [mediaError, setMediaError] = useState("");
  /** Frosted material, live-tuned from Settings: backdrop blur in px and a corner-radius multiplier. */
  const [glassBlur, setGlassBlur] = useState(DEFAULT_GLASS_BLUR);
  const [glassRadius, setGlassRadius] = useState(DEFAULT_GLASS_RADIUS);
  /** How see-through the pane is (100 = nearly clear) and how hard the rim bends the backdrop. */
  const [glassClarity, setGlassClarity] = useState(DEFAULT_GLASS_CLARITY);
  const [glassEdge, setGlassEdge] = useState(DEFAULT_GLASS_EDGE);
  const [glassRefraction, setGlassRefraction] = useState(DEFAULT_GLASS_REFRACTION);
  /** The tint the glass lays down, and the backdrop it sits on. Saved with everything else. */
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const compact = useCompact();
  /** True while the pill's bubble is up: the bar above it steps back and shrinks. */
  const [bubbleRaised, setBubbleRaised] = useState(false);
  /** False until the stored preferences have been applied, so a mount write cannot clobber them. */
  const [settingsReady, setSettingsReady] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  /** The fullscreen lyrics sheet, and the frame its focus is repainted on while it scrolls. */
  const lyricsRef = useRef<HTMLDivElement>(null);
  /** The phone's words, which stand in the artwork's slot instead of in a sheet of their own. */
  const wordsRef = useRef<HTMLDivElement>(null);
  /** The artwork's slot itself, whose distance from the top of the window sizes that space. */
  const artWrapRef = useRef<HTMLDivElement>(null);
  /** The song's title, whose top edge is where the player block begins. */
  const titlesRef = useRef<HTMLDivElement>(null);
  const lyricFrame = useRef(0);
  const glassEdgeRef = useRef<ReturnType<typeof attachGlassEdge> | null>(null);
  /** The WebGL rim, where the engine needs it; null while the SVG map has the job. */
  const glassWebglRef = useRef<GlassWebglHandle | null>(null);
  /** The level the fullscreen speaker comes back to when it is unmuted; 72 is the dial's own default. */
  const lastGainRef = useRef(gain || 72);
  const videoHideTimer = useRef<number | null>(null);
  const prefetchedRef = useRef<Set<string>>(new Set());
  const prefetchRef = useRef<HTMLMediaElement | null>(null);
  const prefetchTimer = useRef<number | null>(null);
  const listPrefetchRef = useRef<HTMLMediaElement[]>([]);
  const prefetchHostRef = useRef<HTMLDivElement>(null);
  const assetStreamRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth", { credentials: "include", cache: "no-store" })
      .then((response) => response.ok ? response.json() : { user: null })
      .then((data: { user?: { email: string; name: string } | null }) => { if (active) { setUser(data.user ?? null); setAuthReady(true); } })
      .catch(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem("onlinemusic-settings");
    // An empty store must still open the write path, or a first visit would never persist anything.
    if (stored) {
      try {
        const data = JSON.parse(stored) as { gain?: number; rate?: number; volume?: number; eq?: number; fadeIn?: number; fadeOut?: number; glassClarity?: number; glassBlur?: number; glassRadius?: number; glassEdge?: number; glassRefraction?: number; glassBandPx?: number; appearance?: Partial<Appearance> };
        if (typeof data.gain === "number") setGain(data.gain);
        if (typeof data.rate === "number") setRate(data.rate);
        if (typeof data.volume === "number") setVolume(data.volume);
        if (typeof data.eq === "number") setEq(data.eq);
        if (typeof data.fadeIn === "number") setFadeIn(data.fadeIn);
        if (typeof data.fadeOut === "number") setFadeOut(data.fadeOut);
        if (typeof data.glassBlur === "number") setGlassBlur(Math.max(0, Math.min(MAX_GLASS_BLUR, data.glassBlur)));
        if (typeof data.glassRadius === "number") setGlassRadius(Math.max(50, Math.min(150, data.glassRadius)));
        if (typeof data.glassClarity === "number") setGlassClarity(Math.max(0, Math.min(100, data.glassClarity)));
        if (typeof data.glassEdge === "number") setGlassEdge(Math.max(0, Math.min(MAX_EDGE_OFFSET, data.glassEdge)));
        // `glassRefraction` was that band as a percent of the pane's short side; it becomes px at
        // the rate the old default (12%) and the new one (30px) imply, so the stored look holds.
        const bandPx = typeof data.glassBandPx === "number" ? data.glassBandPx : typeof data.glassRefraction === "number" ? data.glassRefraction * BAND_PERCENT_TO_PX : null;
        if (bandPx !== null) setGlassRefraction(Math.round(Math.max(0, Math.min(MAX_BAND_PX, bandPx))));
        // Spread over the defaults, so a blob saved before the tint or the backdrop existed opens
        // with those at their defaults rather than undefined.
        if (data.appearance) setAppearance({ ...DEFAULT_APPEARANCE, ...data.appearance });
      } catch { /* ignore malformed local preferences */ }
    }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    // Waiting for the restore keeps the first write from overwriting stored values with defaults
    // (StrictMode runs these effects twice, so the order matters even on a single mount).
    if (!settingsReady) return;
    window.localStorage.setItem("onlinemusic-settings", JSON.stringify({ gain, rate, volume, eq, fadeIn, fadeOut, glassBlur, glassRadius, glassClarity, glassEdge, glassBandPx: glassRefraction, appearance }));
  }, [settingsReady, gain, rate, volume, eq, fadeIn, fadeOut, glassBlur, glassRadius, glassClarity, glassEdge, glassRefraction, appearance]);

  useEffect(() => { setAutoShade(appearance.shade); touchScene(); }, [appearance]);

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

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    // The rim bend is SVG in Chromium and WebGL where CSS cannot bend a backdrop at all (Safari;
    // Chromium too from a development build with ?glasswebgl=1, which is how the two are
    // compared). A WebGL build that cannot start falls through to the SVG path, and thence to the
    // shaded rim, so the panes are never left without something at their edges.
    const webgl = attachGlassWebgl(shell, { blur: glassBlur, clarity: glassClarity / 100, offset: glassEdge, band: glassRefraction, radius: glassRadius / 100 });
    if (webgl) {
      glassWebglRef.current = webgl;
      return () => { webgl.destroy(); glassWebglRef.current = null; };
    }
    const edge = attachGlassEdge(shell);
    glassEdgeRef.current = edge;
    return () => { edge.destroy(); glassEdgeRef.current = null; };
    // Mount only: the sliders are pushed in below, and re-attaching would throw the raster away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => startInkSampler(), []);
  // The five sliders, pushed live: the band re-draws from the raster it already has — and re-reads
  // the veil clarity just rewrote — so moving one never costs a rasterisation. The tint rides
  // along because the band carries it too, and a colour the flat middle has already changed to
  // must not wait on the next slider move to reach the rim.
  useEffect(() => {
    glassWebglRef.current?.setParameters({ blur: glassBlur, clarity: glassClarity / 100, offset: glassEdge, band: glassRefraction, radius: glassRadius / 100 });
  }, [glassBlur, glassClarity, glassEdge, glassRefraction, glassRadius, appearance.tint]);
  useEffect(() => { glassEdgeRef.current?.setOffset(glassEdge); }, [glassEdge]);
  useEffect(() => { glassEdgeRef.current?.setRefraction(glassRefraction); }, [glassRefraction]);

  /** Reads the newline-delimited index and appends each list entry as soon as its line arrives. */
  async function loadRemoteAssets() {
    if (!authReady) return;
    assetStreamRef.current?.abort();
    if (!user) { setAssets([]); return; }
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
      const response = await fetch("/api/assets?index=1", { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) return;
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
  }

  useEffect(() => { void loadRemoteAssets(); }, [user?.email, authReady]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setCurrentTime(0);
    setDuration(0);
    if (asset?.kind === "audio") {
      // Assigning src already starts loading; calling load() again would abort and restart the fetch.
      audio.src = asset.url;
    } else {
      audio.removeAttribute("src");
      audio.load();
    }
  }, [asset?.url, asset?.kind]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    const updateDuration = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const ended = () => {
      // The same walk the transport buttons use, so shuffle and list repeat govern the end of a
      // song too. Nothing to move on to leaves the player stopped, as it has always been.
      const next = trackAt(1);
      if (next) void playAsset(next, playOrder);
      else setPlaying(false);
    };
    audio.addEventListener("timeupdate", updateTime);
    audio.addEventListener("loadedmetadata", updateDuration);
    audio.addEventListener("durationchange", updateDuration);
    audio.addEventListener("ended", ended);
    return () => {
      audio.removeEventListener("timeupdate", updateTime);
      audio.removeEventListener("loadedmetadata", updateDuration);
      audio.removeEventListener("durationchange", updateDuration);
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
    if (!nowOpen) return;
    // Escape unwinds one layer at a time: the lyrics sheet first, the view itself after.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (nowDrawer && compact) { setNowDrawer(false); setNowReveal(0); return; }
      setNowClosing(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nowOpen, nowDrawer, compact]);

  // The sheet and the artwork are one position: whatever opens or closes the drawer — the swipe,
  // Escape, focus landing on a row — the artwork steps out or comes back with it.
  useEffect(() => { setNowReveal(nowDrawer ? 1 : 0); }, [nowDrawer]);

  const previewProgress = duration ? (currentTime / duration) * 100 : 0;

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60).toString().padStart(2, "0");
    return `${minutes}:${remainder}`;
  }

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
      if (videoOverlay || modalOpen || authOpen || parametersOpen) return;
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (asset?.kind === "audio") setPlaying((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [videoOverlay, modalOpen, authOpen, parametersOpen, asset]);

  async function playAsset(nextAsset: Asset, order?: string[]) {
    // Shuffle and list repeat walk songs only: a clip in the listing is dropped here, at the one
    // point every listing feeds through, so no caller can leave a video in the order to be stepped to.
    const songs = new Set(assets.filter((item) => item.kind === "audio").map((item) => item.file.name));
    setPlayOrder(order ? order.filter((name) => songs.has(name)) : []);
    setMediaError("");
    if (nextAsset.kind === "audio" && nextAsset.file.name === asset?.file.name) { const audio = audioRef.current; if (audio) { try { audio.currentTime = 0; } catch { /* metadata not loaded yet */ } setCurrentTime(0); safePlay(audio); } }
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

  function seekTo(value: number) {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function seekFromPointer(event: React.MouseEvent<HTMLElement>) {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    seekTo(duration * ratio);
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

  /**
   * The small screen's way to the lyrics. The sheet is a position rather than a switch: a downward
   * drag anywhere on the stage that is not a control brings it up, and on the artwork a leftward
   * drag does the same, carrying the artwork out of the window with it. Once it is up, a rightward
   * drag on the stage pulls it back down and brings the artwork back in. The axis is locked in the
   * first few pixels, so a scroll intent and a sideways swipe never fight, and the pointer is only
   * captured once an axis is committed — capturing on the way down would swallow the progress
   * slider's own drag.
   */
  const nowGesture = useRef<{ pointer: number; x: number; y: number; axis: "x" | "y" | null; onArt: boolean; from: number; time: number } | null>(null);

  function nowGestureStart(event: ReactPointerEvent<HTMLElement>) {
    if (!compact) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,button,.now-progress,.now-transport,.now-drawer")) return;
    nowGesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, axis: null, onArt: Boolean(target.closest(".now-art-wrap")), from: nowDrawer ? 1 : nowReveal, time: performance.now() };
  }

  function nowGestureMove(event: ReactPointerEvent<HTMLElement>) {
    const state = nowGesture.current;
    if (!state || event.pointerId !== state.pointer) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      setNowAxis(state.axis);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    }
    // Only the direction that moves the sheet towards where it already is counts: down and to the
    // left bring it up, to the right puts it back, and a drag the other way is simply held still.
    const travel = state.axis === "y" ? Math.max(0, dy) : state.from > 0.5 ? -Math.max(0, dx) : state.onArt ? Math.max(0, -dx) : 0;
    setNowReveal(Math.max(0, Math.min(1, state.from + travel / 220)));
  }

  function nowGestureEnd(event: ReactPointerEvent<HTMLElement>) {
    const state = nowGesture.current;
    nowGesture.current = null;
    if (!state) return;
    setNowAxis(null);
    // A tap while the sheet is up puts it away again, wherever it landed.
    if (!state.axis) {
      if (nowDrawer) setNowDrawer(false);
      return;
    }
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    const speed = dy / Math.max(1, performance.now() - state.time);
    const width = event.currentTarget.clientWidth;
    // The sheet keeps whatever the drag left it nearest to: a long drag, or a short quick one,
    // decides, and a drag that only nudged it falls back to the side it started on.
    const open = state.axis === "y"
      ? state.from > 0.5 || dy > 64 || (dy > 24 && speed > 0.5)
      : state.from > 0.5
        ? !(dx > 64 || dx > width * 0.28)
        : state.onArt && (dx < -72 || dx < -(width * 0.28));
    setNowReveal(open ? 1 : 0);
    if (open) { setNowPanel("lyrics"); setNowDrawer(true); }
    else setNowDrawer(false);
  }

  function goTo(nextView: View) {
    setView(nextView);
    setSidebarOpen(false);
    setParametersOpen(false);
    setExpandedAlbum(null);
  }

  const visibleAssets = assets.filter((item) => !search || item.file.name.toLowerCase().includes(search.toLowerCase()));
  const playableAssets = assets.filter((item) => item.kind === "audio" || item.kind === "video");

  const listedAssets = view === "projects" ? assets : visibleAssets;
  const { groups: albumGroups, loose: looseAssets } = groupByAlbum(listedAssets);
  const albums = groupByAlbum(visibleAssets, true).groups.sort((a, b) => a.album.localeCompare(b.album));

  /** The navigation, as the pill's tabs: the sidebar's five screens, with the same live counts. */
  const pillItems = useMemo<PillItem[]>(() => [
    { id: "studio", label: "Home", icon: <House size={19} /> },
    { id: "projects", label: "Projects", icon: <Music2 size={19} />, badge: assets.length || undefined },
    { id: "albums", label: "Albums", icon: <Disc3 size={19} />, badge: albums.length || undefined },
    { id: "library", label: "Library", icon: <Library size={19} /> },
    { id: "settings", label: "Settings", icon: <Settings size={19} /> },
  ], [assets.length, albums.length]);

  /** What the transport walks and the queue list shows: the playing order, else the view's songs. */
  const queueNames = playOrder.length > 0 ? playOrder : audioNames(listedAssets);
  const queueItems = queueNames.map((name) => assets.find((item) => item.file.name === name)).filter((item): item is Asset => Boolean(item));
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
    return <button className="project-card" key={item.file.name} onClick={() => { void playAsset(item, audioNames(listedAssets)); }} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}><div className={`project-art art-${index % 4} ${item.kind === "audio" ? "audio-art" : ""}`}>{cover ? <img src={cover} alt="" loading="lazy" decoding="async" /> : item.kind === "video" ? <MediaThumb item={item} /> : item.kind === "image" ? <img src={item.url} alt="" loading="lazy" decoding="async" /> : <Music2 size={28} />}</div><strong>{name}</strong><small>{formatBytes(assetSize(item))} · {item.kind}</small><span className="project-menu-wrap"><span className="project-menu-button" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); setProjectMenu(projectMenu === item.file.name ? null : item.file.name); }}><MoreHorizontal size={17} /></span>{projectMenu === item.file.name && <span className="project-menu" onClick={(event) => event.stopPropagation()}><span onClick={() => { setPlaying(false); setAsset(item); setMetadataPanelOpen(true); setProjectMenu(null); }}>Edit metadata</span></span>}</span></button>;
  }

  const waveform = useMemo(() => Array.from({ length: 78 }, (_, index) => 18 + ((index * 37) % 68)), []);

  /** Lyrics for the selected track: plain text, with any LRC time stamps stripped for display. */
  const lyricsLines = useMemo(() => {
    const raw = typeof asset?.metadata.lyrics === "string" ? asset.metadata.lyrics : "";
    return raw.replace(/\r/g, "").split("\n")
      .map((line) => line.replace(/^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]\s*/g, "").trim())
      .filter(Boolean);
  }, [asset?.metadata.lyrics]);

  /**
   * The fullscreen lyrics are read through a focus: the line nearest the middle of the sheet is
   * the sharp one, and the words soften as they run away from it, so the page reads as a column
   * of light rather than a wall of text. Each line carries its own `--lyric-focus` (1 at the
   * centre, 0 at the sheet's edge) and the stylesheet turns that into a blur — the panel behind
   * them stays plain, which is the whole point of doing it on the words.
   */
  function paintLyrics() {
    lyricFrame.current = 0;
    const sheet = wordsRef.current ?? lyricsRef.current;
    if (!sheet) return;
    // The phone's words are read in the upper space as a whole rather than inside the artwork's
    // own box: the slot plus the room the centred column leaves above it. That room moves with
    // the window, so it is measured here, where the layout is being read anyway, and the
    // stylesheet does the centring with it.
    const box = sheet.getBoundingClientRect();
    const middle = box.top + box.height / 2;
    const reach = Math.max(110, box.height * 0.5);
    for (const line of Array.from(sheet.children) as HTMLElement[]) {
      const rect = line.getBoundingClientRect();
      const distance = Math.min(1, Math.abs(rect.top + rect.height / 2 - middle) / reach);
      line.style.setProperty("--lyric-focus", (1 - distance).toFixed(3));
    }
  }

  /**
   * The phone's stage is one rectangle: the window above the player block — from the top of the
   * screen down to the top of the song's title, which is where that block begins. The artwork is
   * centred in it, and so are the words that take the artwork's place, which is what the two gaps
   * measured here are for: the room from that rectangle's top edge down to the artwork's slot, and
   * the room from the slot's bottom down to the block. Nothing is guessed, because the slot's
   * place is whatever the window and the title leave it; the stylesheet only does the arithmetic.
   */
  useEffect(() => {
    if (!nowOpen || !compact) return;
    const measure = () => {
      const wrap = artWrapRef.current;
      const titles = titlesRef.current;
      const view = wrap?.closest(".now-view");
      if (!wrap || !titles || !view) return;
      // Everything is read against the view's own box, not the screen: the view rises through the
      // window when it opens, and an absolute reading taken mid-animation would carry that slide.
      // The view is fixed and inset:0, so once it lands its box is the screen and the two agree.
      const viewTop = view.getBoundingClientRect().top;
      const slotTop = wrap.getBoundingClientRect().top - viewTop;
      const slotBottom = slotTop + wrap.offsetHeight;
      const barTop = titles.getBoundingClientRect().top - viewTop;
      wrap.style.setProperty("--now-upper-top", `${Math.round(slotTop)}px`);
      wrap.style.setProperty("--now-upper-bottom", `${Math.round(barTop - slotBottom)}px`);
      // The cover's own centre sits at the middle of its slot; the rise it needs is that centre
      // taken from the middle of the rectangle.
      wrap.style.setProperty("--now-lift", `${Math.round(slotTop + wrap.offsetHeight / 2 - barTop / 2)}px`);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowOpen, compact, nowPanel, lyricsLines.length]);

  useEffect(() => {
    const sheet = wordsRef.current ?? lyricsRef.current;
    if (!sheet || !nowOpen || nowPanel !== "lyrics") return;
    const schedule = () => { if (!lyricFrame.current) lyricFrame.current = window.requestAnimationFrame(paintLyrics); };
    paintLyrics();
    sheet.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      sheet.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (lyricFrame.current) window.cancelAnimationFrame(lyricFrame.current);
      lyricFrame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowOpen, nowPanel, lyricsLines.length, compact]);

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
      const response = await fetch("/api/assets", { method: "POST", credentials: "include", body: form });
      if (!response.ok) return false;
      const payload = await response.json() as { asset?: { id?: string; fileUrl?: string } };
      if (payload.asset?.id) { setAsset((current) => current?.file === localAsset.file ? { ...current, apiId: payload.asset!.id, url: payload.asset!.fileUrl || current.url } : current); if (reload) await loadRemoteAssets(); return true; }
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

  /** Applies a change to one import across both the list and the selected asset. */
  function patchImportedAsset(file: File, patch: (item: Asset) => Asset) {
    setAssets((current) => current.map((item) => (item.file === file ? patch(item) : item)));
    setAsset((current) => (current && current.file === file ? patch(current) : current));
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
      patchImportedAsset(item.file, () => next);
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
    const reader = new FileReader();
    reader.onload = () => { setAsset((current) => current ? { ...current, metadata: { ...current.metadata, coverData: String(reader.result) } } : current); setSaved(false); };
    reader.readAsDataURL(file);
  }

  function updateMetadata(field: "title" | "artist" | "album" | "genre", value: string) {
    setAsset((current) => (current ? { ...current, [field]: value } : current));
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
        const response = await fetch(`/api/assets/${encodeURIComponent(asset.apiId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: asset.file.name,
            metadata: { title: asset.title, artist: asset.artist, album: asset.album, genre: asset.genre, coverData: asset.metadata.coverData, gain, rate, eq, fadeIn, fadeOut },
          }),
        });
        if (!response.ok) return;
      } catch {
        // Keep local metadata changes when the API is unavailable.
      }
    }
    setSaved(true);
    window.localStorage.setItem(`onlinemusic-metadata-${asset.file.name}`, JSON.stringify({ title: asset.title, artist: asset.artist, album: asset.album, genre: asset.genre }));
  }

  return (
    <div ref={shellRef} className="studio-shell" data-bg={appearance.bgKind} data-theme={appearance.shellLuma < 0.5 ? "dark" : "light"} data-bubble={bubbleRaised ? "" : undefined} style={{ ...appearanceStyle, "--glass-radius": String(glassRadius / 100), "--glass-blur": `${glassBlur}px`, "--glass-clarity": String(glassClarity / 100), "--glass-band": `${glassRefraction}px`, "--glass-pull": String(glassEdge) } as CSSProperties}>
      {/* The backdrop: fixed, so it holds still under a scrolling page, and a real element, so the
          WebGL raster carries it. Everything else paints above it by document order. */}
      <div className="shell-bg" data-raster-fill aria-hidden="true" />
      {/* Colour behind the panes: a frosted surface only reads as glass when there is something behind it to blur. */}
      <div className="ambient" aria-hidden="true"><span className="ambient-orb orb-a" /><span className="ambient-orb orb-b" /></div>
      {!compact && <aside className={`sidebar ${sidebarOpen ? "is-open" : ""}`} data-glass-edge="">
        <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>onlineMusic</span></div>
        <nav className="nav-group"><p className="eyebrow">Listen</p><button className={`nav-item ${view === "studio" ? "active" : ""}`} onClick={() => goTo("studio")}><House size={17} /> Home</button><button className={`nav-item ${view === "projects" ? "active" : ""}`} onClick={() => goTo("projects")}><Music2 size={17} /> My Projects <span className="nav-count">{assets.length}</span></button><button className={`nav-item ${view === "albums" ? "active" : ""}`} onClick={() => goTo("albums")}><Disc3 size={17} /> Albums <span className="nav-count">{albums.length}</span></button><button className={`nav-item ${view === "library" ? "active" : ""}`} onClick={() => goTo("library")}><Library size={17} /> Media Library</button></nav>
        <div className="sidebar-bottom"><button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => goTo("settings")}><Settings size={17} /> Settings</button><button className="profile profile-button" onClick={() => { setAuthError(""); setAuthOpen(true); }}><div className="avatar">{user?.name?.slice(0,2).toUpperCase() || "JL"}</div><div><strong>{user?.name || "Guest user"}</strong><small>{user ? user.email : "Sign in to sync"}</small></div></button></div>
      </aside>}

      <section className="content-area">
        <header className="topbar" data-glass-edge={compact ? undefined : ""}><button className="menu-button" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu"><Menu size={20} /></button><div className="breadcrumbs"><span>{viewTitles[view]}</span><ChevronDown size={14} /><strong>{view === "studio" ? "Media workspace" : view === "settings" ? "Glass, colour and background" : "Your collection"}</strong></div><div className="top-actions">{searchOpen && <input className="search-input" autoFocus value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your music" />}<button className="icon-button" onClick={() => setSearchOpen((open) => !open)} aria-label="Search"><Search size={18} /></button><button className="icon-button" onClick={() => alert("Help center is available from your workspace.")} aria-label="Help"><CircleHelp size={18} /></button><button className="top-avatar top-avatar-button" onClick={() => setAuthOpen(true)}>{user?.name?.slice(0,2).toUpperCase() || "JL"}</button></div></header>
        <div className="page-content">
          {view === "settings" ? <AppearanceSettings blur={glassBlur} onBlur={setGlassBlur} clarity={glassClarity} onClarity={setGlassClarity} edge={glassEdge} onEdge={setGlassEdge} refraction={glassRefraction} onRefraction={setGlassRefraction} radius={glassRadius} onRadius={setGlassRadius} appearance={appearance} onAppearance={(patch) => setAppearance((current) => ({ ...current, ...patch }))} onClose={() => goTo("studio")} /> : view === "albums" ? <section className="collection-view"><div className="collection-heading"><h1>Albums</h1><button className="primary-button" onClick={openImport}><Plus size={17} /> Import media</button></div>{albums.length === 0 && <div className="project-grid"><div className="empty-assets">No albums yet. Import songs that carry an album tag to build your collection.</div></div>}<div className="album-grid">{albums.map((entry) => { const key = entry.album.toLowerCase(); const cover = albumCover(entry.items); const expanded = expandedAlbum === key; return <button className={`album-card ${expanded ? "is-expanded" : ""}`} key={key} onClick={() => setExpandedAlbum(expanded ? null : key)}><span className="album-card-art">{cover ? <img src={String(cover)} alt="" /> : <Disc3 size={26} />}</span><strong>{entry.album}</strong><small>{albumArtist(entry.items) || "Unknown artist"} · {entry.items.length} {entry.items.length === 1 ? "track" : "tracks"}</small></button>; })}</div>{albums.filter((entry) => entry.album.toLowerCase() === expandedAlbum).map((entry) => { const cover = albumCover(entry.items); return <section className="album-detail" key={entry.album.toLowerCase()}><header className="album-detail-head"><span className="album-cover">{cover ? <img src={String(cover)} alt="" /> : <Disc3 size={18} />}</span><div><strong>{entry.album}</strong><small>{albumArtist(entry.items) || "Unknown artist"} · {entry.items.length} {entry.items.length === 1 ? "track" : "tracks"}</small></div><button className="primary-button" onClick={() => playAlbum(entry.items, 0)}><Play size={15} /> Play all</button><button className="icon-button" onClick={() => setExpandedAlbum(null)} aria-label="Collapse album"><X size={17} /></button></header><div className="track-list">{entry.items.map((item, index) => <button className={`track-row ${asset?.file.name === item.file.name ? "is-current" : ""}`} key={item.file.name} onClick={() => playAlbum(entry.items, index)} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}><span className="track-no">{trackLabel(item, index)}</span><span className="track-title">{item.title || item.file.name}</span><small>{formatBytes(assetSize(item))}</small></button>)}</div></section>; })}<button className="back-link" onClick={() => goTo("studio")}><ArrowLeft size={16} /> Back to studio</button></section> : view !== "studio" ? <section className="collection-view"><div className="collection-heading"><h1>{view === "projects" ? "My Projects" : "Media Library"}</h1><button className="primary-button" onClick={openImport}><Plus size={17} /> New project</button></div>{listedAssets.length === 0 && <div className="project-grid"><div className="empty-assets">No saved media yet. Import a file to create your first project.</div></div>}{albumGroups.map((group) => { const cover = albumCover(group.items); return <section className="album-group" key={group.album.toLowerCase()}><header className="album-heading"><span className="album-cover">{cover ? <img src={String(cover)} alt="" /> : <Disc3 size={18} />}</span><div><strong>{group.album}</strong><small>{group.items.length} {group.items.length === 1 ? "track" : "tracks"}</small></div></header><div className="project-grid">{group.items.map(renderProjectCard)}</div></section>; })}{looseAssets.length > 0 && <div className="project-grid">{looseAssets.map(renderProjectCard)}</div>}<button className="back-link" onClick={() => goTo("studio")}><ArrowLeft size={16} /> Back to studio</button></section> : <>
          <div className="welcome-row"><h1>Your media studio <span>✦</span></h1><div className="welcome-actions"><button className="ghost-button" onClick={openImport}><Upload size={16} /> Import audio</button><button className="primary-button" onClick={openImport}><Plus size={17} /> New project</button></div></div>
          <div className="section-heading asset-heading"><h2>Your assets</h2><div className="asset-tools"><span className="asset-count">{assets.length} assets</span>{queue.length > 0 && <span className="asset-count">{queue.length} queued</span>}<button className="small-action" onClick={openImport}><Plus size={14} /> Add</button></div></div>
          <div className="asset-strip">{assets.slice(0, 4).map((item) => <button className={`asset-card ${asset?.file.name === item.file.name ? "selected-asset" : ""}`} key={item.file.name} onClick={() => { setPlaying(false); setAsset(item); }} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}><span className="asset-thumb imported">{asset?.file.name === item.file.name ? <Check size={18} /> : item.kind === "video" ? <FileVideo size={19} /> : <FileAudio size={19} />}</span><span className="asset-text"><strong>{item.title || item.file.name}</strong><small>{formatBytes(assetSize(item))} · {item.kind}</small></span></button>)}{assets.length === 0 && <div className="empty-assets">No local media yet. Import a file to begin.</div>}</div>
          {asset?.kind === "audio" ? <section className="editor-layout"><div className="editor-panel panel"><div className="panel-heading"><div><p className="eyebrow">Selected asset</p><h2>{asset.title || asset.file.name}</h2></div><div className="panel-heading-actions"><button className="toolbar-button" onClick={() => setParametersOpen(true)}><SlidersHorizontal size={14} /> Full parameter editor</button><button className="icon-button" aria-label="Close editor" onClick={() => { setPlaying(false); setAsset(null); }}><X size={17} /></button></div></div><div className="wave-editor"><div className="wave-toolbar"><span><Activity size={15} /> Waveform</span><button className="toolbar-button" onClick={togglePlayback}>{playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause" : "Preview"}</button></div><div className="wave-track interactive-wave" onClick={seekFromPointer} role="slider" aria-label="Seek waveform" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} tabIndex={0}><div className="wave-bars">{waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><div className="playhead" style={{ left: `${previewProgress}%` }} /></div><div className="wave-times"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div></div><div className="controls-grid"><RangeControl label="Gain" value={gain} min={0} max={100} display={`${gain}%`} onChange={setGain} /><RangeControl label="Playback rate" value={rate} min={50} max={150} display={`${(rate / 100).toFixed(2)}x`} onChange={setRate} /></div><div className="advanced-row"><button className="toolbar-button" onClick={() => setShowAdvanced((open) => !open)}><SlidersHorizontal size={14} /> {showAdvanced ? "Hide sound controls" : "More sound controls"}</button>{showAdvanced && <RangeControl label="Tone / EQ" value={eq} min={-100} max={100} display={`${eq > 0 ? "+" : ""}${eq}`} onChange={setEq} />}</div><button className="queue-add" onClick={addToQueue}><ListMusic size={14} /> Add to queue</button></div><aside className="details-column"><div className="panel metadata-panel"><div className="panel-title"><SlidersHorizontal size={16} /><h3>Metadata</h3></div>{(["title", "artist", "album", "genre"] as const).map((field) => <label key={field}>{field}<input value={asset[field]} placeholder={`Add ${field}`} onChange={(event) => updateMetadata(field, event.target.value)} /></label>)}<button className="save-button" onClick={saveMetadata}>{saved ? "Saved" : "Save metadata"}</button></div></aside></section> : <section className="empty-editor panel"><div className="empty-icon"><FolderOpen size={22} /></div><div><h2>Select an asset to edit</h2></div><button className="small-action" onClick={openImport}><Plus size={14} /> Import media</button></section>}
          </>}
        </div>
      </section>
      {parametersOpen && asset && <ParametersScreen
        title={asset.title || asset.file.name}
        waveform={waveform}
        duration={duration}
        currentTime={currentTime}
        previewProgress={previewProgress}
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
        onSeekPointer={seekFromPointer}
        onClose={() => setParametersOpen(false)}
        formatTime={formatTime}
      />}

      {view === "projects" && metadataPanelOpen && asset && <><aside className="metadata-float" data-glass-edge=""><div className="metadata-float-header"><div><p className="eyebrow">Project metadata</p><h2>{asset.title || asset.file.name}</h2></div><button className="icon-button" onClick={() => setMetadataPanelOpen(false)}><X size={17} /></button></div>{(["title", "artist", "album", "genre"] as const).map((field) => <label key={field}>{field}<input value={asset[field]} placeholder={`Add ${field}`} onChange={(event) => updateMetadata(field, event.target.value)} /></label>)}<button className="cover-button" onClick={chooseCover}><Upload size={14} /> {coverSrc(asset) ? "Change cover image" : "Add cover image"}</button></aside><input ref={coverInputRef} type="file" accept="image/*" onChange={onCoverInput} hidden /></>}

      {nowOpen && <section className={`now-view ${nowTint ? "has-tint" : ""} ${nowClosing ? "is-closing" : ""}`} onAnimationEnd={(event) => { if (event.target === event.currentTarget && nowClosing) { setNowOpen(false); setNowClosing(false); } }} style={nowTint ? ({ "--np-tint": nowTint } as CSSProperties) : undefined} aria-label="Now playing"><div className="now-backdrop" aria-hidden="true" /><header className="now-head"><button className="now-close" onClick={() => setNowClosing(true)} aria-label="Close now playing" title="Close"><X size={18} /></button><p className="now-kicker">Now playing</p><div className="now-volume"><input type="range" min="0" max="100" value={gain} style={{ "--seek": `${gain}%` } as CSSProperties} onChange={(event) => setGain(Number(event.target.value))} aria-label="Volume" /><button className="now-volume-icon" onClick={toggleMute} aria-label={gain === 0 ? "Unmute" : "Mute"} title={gain === 0 ? "Unmute" : "Mute"}>{gain === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button></div></header><div className={`now-body ${nowDrawer ? "is-drawer-open" : "is-drawer-closed"}`}><div className={`now-stage ${nowAxis ? "is-dragging" : ""}`} style={{ "--now-reveal": String(nowReveal) } as CSSProperties} onPointerDown={nowGestureStart} onPointerMove={nowGestureMove} onPointerUp={nowGestureEnd} onPointerCancel={() => { nowGesture.current = null; setNowAxis(null); }}><div className="now-art-wrap" ref={artWrapRef}><div className={`now-art ${nowAudio && barCover ? "" : "is-empty"}`}>{nowAudio && barCover ? <img src={barCover} alt="" /> : <Music2 size={72} />}</div>{compact && nowPanel === "lyrics" && <div className="now-lyrics now-words" ref={wordsRef}>{lyricsLines.map((line, index) => <p key={index}>{line}</p>)}{lyricsLines.length === 0 && <p className="now-empty">No lyrics for this song yet.</p>}</div>}</div><div className="now-titles" ref={titlesRef}><h2>{nowAudio ? nowAudio.title || nowAudio.file.name : "Not Playing"}</h2></div><div className="now-progress progress-wrap"><span>{formatTime(nowAudio ? currentTime : 0)}</span><input type="range" min="0" max={nowAudio && duration ? duration : 1} step="0.1" value={nowAudio ? currentTime : 0} style={{ "--seek": `${nowAudio ? previewProgress : 0}%` } as CSSProperties} onChange={(event) => seekTo(Number(event.target.value))} disabled={!nowAudio} aria-label="Seek" /><span>−{formatTime(nowAudio ? Math.max(0, duration - currentTime) : 0)}</span></div><div className="now-transport"><button className={`transport-extra ${shuffleOn ? "is-on" : ""}`} onClick={() => setShuffleOn((on) => !on)} disabled={!canStep} aria-label="Shuffle" aria-pressed={shuffleOn} title="Shuffle"><Shuffle size={19} /></button><button className="transport-step" onClick={() => playTrack(-1)} disabled={!canStep} aria-label="Previous song" title="Previous"><SkipBack size={24} fill="currentColor" /></button><button className={`now-play ${playStarting ? "is-starting" : ""}`} onClick={togglePlayback} disabled={!nowAudio} aria-label={nowAudio && playing ? "Pause" : "Play"}>{playing && nowAudio ? <PauseGlyph size={40} /> : <PlayGlyph size={40} />}</button><button className="transport-step" onClick={() => playTrack(1)} disabled={!canStep} aria-label="Next song" title="Next"><SkipForward size={24} fill="currentColor" /></button><button className={`transport-extra ${loopOn ? "is-on" : ""}`} onClick={() => setLoopOn((on) => !on)} disabled={!canStep} aria-label="Repeat list" aria-pressed={loopOn} title="Repeat list"><Repeat size={19} /></button></div></div>{!compact && <div className="now-drawer" onFocus={() => setNowDrawer(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setNowDrawer(false); }}><aside className={`now-queue ${nowPanel === "lyrics" ? "is-lyrics" : ""}`}>{nowPanel === "queue" && <header><div className="now-queue-copy"><h3>Continue playing</h3><p>{nowAudio?.album ? `From ${nowAudio.album}` : "From all songs"}</p></div></header>}{nowPanel === "lyrics" ? <div className="now-lyrics" ref={lyricsRef}>{lyricsLines.map((line, index) => <p key={index}>{line}</p>)}{lyricsLines.length === 0 && <p className="now-empty">No lyrics for this song yet.</p>}</div> : <ol>{queueItems.map((item) => <li key={item.file.name}><button className={`now-row ${item.file.name === nowAudio?.file.name ? "is-current" : ""}`} onClick={() => { void playAsset(item, queueNames); }}><span className="now-row-art">{coverSrc(item) ? <img src={coverSrc(item)} alt="" loading="lazy" decoding="async" /> : <Music2 size={14} />}</span><span className="now-row-copy"><strong>{item.title || item.file.name}</strong><small>{[item.artist, item.album].filter(Boolean).join(" — ") || "Unknown artist"}</small></span></button></li>)}{queueItems.length === 0 && <li className="now-empty">Nothing else in this project yet.</li>}</ol>}</aside><div className="now-switch" role="tablist" aria-label="Right panel"><button role="tab" aria-selected={nowDrawer && nowPanel === "lyrics"} className={nowDrawer && nowPanel === "lyrics" ? "is-on" : ""} onClick={() => { setNowPanel("lyrics"); setNowDrawer(true); }} aria-label="Lyrics" title="Lyrics"><MessageSquareQuote size={17} /></button><button role="tab" aria-selected={nowDrawer && nowPanel === "queue"} className={nowDrawer && nowPanel === "queue" ? "is-on" : ""} onClick={() => { setNowPanel("queue"); setNowDrawer(true); }} aria-label="Continue playing" title="Continue playing"><List size={17} /></button></div></div>}</div></section>}

      {videoOverlay && <div className={`video-overlay ${videoControlsVisible ? "video-controls-visible" : ""}`} onMouseMove={(event) => { const nearBottom = window.innerHeight - event.clientY < 150; if (nearBottom) { setVideoControlsVisible(true); if (videoHideTimer.current) window.clearTimeout(videoHideTimer.current); videoHideTimer.current = window.setTimeout(() => setVideoControlsVisible(false), 1800); } else if (!event.currentTarget.querySelector(".video-player-dock:hover")) { setVideoControlsVisible(false); } }} onMouseLeave={() => { if (videoHideTimer.current) window.clearTimeout(videoHideTimer.current); setVideoControlsVisible(false); }}><video ref={videoRef} src={videoOverlay.url} autoPlay playsInline onPlay={() => setVideoPlaying(true)} onPause={() => setVideoPlaying(false)} onLoadedMetadata={(event) => setVideoDuration(event.currentTarget.duration)} onTimeUpdate={(event) => setVideoProgress(event.currentTarget.currentTime)} /><div className="video-shell-sidebar"><aside className="sidebar" data-glass-edge="">{/* Same rail styling as the main sidebar, but listing the media you can play. */}<div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>onlineMusic</span></div><nav className="nav-group video-playlist"><p className="eyebrow">Songs &amp; videos</p>{playableAssets.map((item) => <button className={`nav-item ${videoOverlay.file.name === item.file.name ? "active" : ""}`} key={item.file.name} onClick={() => playFromVideoOverlay(item)} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}>{item.kind === "video" ? <FileVideo size={16} /> : <Music2 size={16} />}<span className="playlist-title">{item.title || item.file.name}</span></button>)}{playableAssets.length === 0 && <p className="playlist-empty">Nothing to play yet.</p>}</nav><div className="sidebar-bottom"><button className="profile profile-button" onClick={() => { setAuthError(""); setAuthOpen(true); }}><div className="avatar">{user?.name?.slice(0,2).toUpperCase() || "JL"}</div><div><strong>{user?.name || "Guest user"}</strong><small>{user ? user.email : "Sign in to sync"}</small></div></button></div></aside></div><div className={`video-dock-hit-zone ${videoControlsVisible ? "is-visible" : ""}`} onMouseEnter={() => setVideoControlsVisible(true)} onMouseLeave={() => window.setTimeout(() => setVideoControlsVisible(false), 250)}><div className={`video-player-dock ${videoControlsVisible ? "is-visible" : ""}`} data-glass-edge="3"><div className="now-playing"><span className="mini-cover"><FileVideo size={16} /></span><div className="now-playing-copy"><strong><span>{videoOverlay.title || videoOverlay.file.name}</span></strong><small>video · local preview</small></div></div><div className="player-controls"><button className="icon-button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10); }}><SkipBack size={16} /></button><button className="player-button" onClick={() => { const video = videoRef.current; if (!video) return; if (video.paused) void video.play(); else video.pause(); }}>{videoPlaying ? <PauseGlyph size={17} /> : <PlayGlyph size={17} />}</button><button className="icon-button" onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(videoDuration, videoRef.current.currentTime + 10); }}><SkipForward size={16} /></button><div className="progress-wrap"><span>{formatTime(videoProgress)}</span><input type="range" min="0" max={videoDuration || 1} step="0.1" value={videoProgress} style={{ "--seek": `${videoDuration ? (videoProgress / videoDuration) * 100 : 0}%` } as CSSProperties} onChange={(event) => { const value = Number(event.target.value); if (videoRef.current) videoRef.current.currentTime = value; setVideoProgress(value); }} /><span>{formatTime(videoDuration)}</span></div></div><div className="player-actions"><Volume2 size={17} /><input type="range" min="0" max="100" defaultValue="100" onChange={(event) => { if (videoRef.current) videoRef.current.volume = Number(event.target.value) / 100; }} /><button className="queue-button" onClick={() => { videoRef.current?.pause(); setVideoPlaying(false); setVideoOverlay(null); }}><X size={16} /> Close</button></div></div></div></div>}

      <audio ref={audioRef} preload="metadata" onError={(event) => { const element = event.currentTarget; if (asset?.kind !== "audio" || !element.getAttribute("src")) return; setMediaError("This browser cannot decode this file"); }} />
      <div ref={prefetchHostRef} className="prefetch-host" aria-hidden="true" />

      {lyricsOpen && <aside className="glass-panel lyrics-panel" data-glass-edge="" aria-label="Lyrics"><header className="glass-panel-head"><div><p className="eyebrow">Lyrics</p><h3>{asset?.title || "Not Playing"}</h3></div><button className="icon-button" onClick={() => setLyricsOpen(false)} aria-label="Close lyrics"><X size={16} /></button></header>{lyricsLines.length > 0 ? <div className="lyrics-body">{lyricsLines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}</div> : <p className="glass-empty">No lyrics found. Lyrics stored in the file&apos;s tags appear here after import.</p>}</aside>}

      {projectsOpen && <aside className="glass-panel projects-panel" data-glass-edge="" aria-label="Projects"><header className="glass-panel-head"><div><p className="eyebrow">Projects</p><h3>{assets.length} item{assets.length === 1 ? "" : "s"}{queue.length > 0 ? ` · ${queue.length} queued` : ""}</h3></div><button className="icon-button" onClick={() => setProjectsOpen(false)} aria-label="Close projects"><X size={16} /></button></header><div className="project-list">{queue.length > 0 && <section className="project-list-group"><p className="eyebrow">Queue</p>{queue.map((name) => <span className="project-list-row is-queued" key={`queued-${name}`}><ListMusic size={14} /><span className="project-list-name">{name}</span></span>)}</section>}<section className="project-list-group"><p className="eyebrow">Media</p>{assets.map((item) => <button className={`project-list-row ${asset?.file.name === item.file.name ? "is-current" : ""}`} key={item.file.name} onClick={() => { void playAsset(item); }} onPointerEnter={() => schedulePrefetch(item)} onPointerLeave={cancelPrefetch}>{item.kind === "video" ? <FileVideo size={14} /> : item.kind === "audio" ? <Music2 size={14} /> : <Layers3 size={14} />}<span className="project-list-name">{item.title || item.file.name}</span><small>{formatBytes(assetSize(item))}</small></button>)}{assets.length === 0 && <p className="glass-empty">Nothing imported yet.</p>}</section></div></aside>}

      {compact && !videoOverlay && <BottomPill items={pillItems} current={view} onSelect={(id) => goTo(id as View)} onRaiseChange={setBubbleRaised} onBubbleMove={() => glassWebglRef.current?.refresh()} />}

      {!videoOverlay && <div className={`player glass-bar ${asset?.kind === "audio" && playing ? "audio-playing" : ""}`} data-glass-edge="3"><div className="now-playing"><button className="mini-cover-button" onClick={() => { setNowDrawer(false); setNowOpen(true); }} aria-label="Open now playing" title="Now playing"><span className={`mini-cover ${playing && asset?.kind === "audio" ? "is-playing" : ""}`}>{barCover ? <img src={barCover} alt="" /> : asset?.kind === "video" ? <FileVideo size={16} /> : <Music2 size={16} />}<span className="mini-cover-expand" aria-hidden="true"><Maximize2 size={13} /></span></span></button><div className="now-playing-copy"><strong className={asset && (asset.title || asset.file.name).length > 28 ? "is-long-title" : ""}><span>{asset?.title || "No asset selected"}</span></strong><small className={mediaError ? "is-error" : ""}>{mediaError || (asset ? `${asset.kind} · local preview` : "Import something to begin")}</small></div></div><div className="player-controls">{canStep && <button className={`transport-extra ${shuffleOn ? "is-on" : ""}`} onClick={() => setShuffleOn((on) => !on)} aria-label="Shuffle" aria-pressed={shuffleOn} title="Shuffle"><Shuffle size={15} /></button>}<button className="icon-button transport-step" onClick={() => playTrack(-1)} disabled={!canStep} aria-label="Previous song" title="Previous"><SkipBack size={16} fill="currentColor" /></button><button className={`player-button ${playStarting ? "is-starting" : ""}`} onClick={togglePlayback} aria-label={playing ? "Pause" : "Play"} disabled={!asset || asset.kind !== "audio"}>{playing ? <PauseGlyph size={26} /> : <PlayGlyph size={26} />}</button><button className="icon-button transport-step" onClick={() => playTrack(1)} disabled={!canStep} aria-label="Next song" title="Next"><SkipForward size={16} fill="currentColor" /></button>{canStep && <button className={`transport-extra ${loopOn ? "is-on" : ""}`} onClick={() => setLoopOn((on) => !on)} aria-label="Repeat list" aria-pressed={loopOn} title="Repeat list"><Repeat size={15} /></button>}<div className="progress-wrap"><span>{formatTime(currentTime)}</span><input type="range" min="0" max={duration || 1} step="0.1" value={currentTime} style={{ "--seek": `${previewProgress}%` } as CSSProperties} onChange={(event) => seekTo(Number(event.target.value))} /><span>{formatTime(duration)}</span></div></div><div className={`player-actions bar-cluster ${volumeOpen ? "is-volume-open" : ""}`}><button className={`glass-button bar-tool ${lyricsOpen ? "is-active" : ""}`} onClick={() => { setLyricsOpen((open) => !open); setProjectsOpen(false); }} aria-label="Lyrics" title="Lyrics"><MessageSquareQuote size={17} /></button><button className={`glass-button bar-tool ${projectsOpen ? "is-active" : ""}`} onClick={() => { setProjectsOpen((open) => !open); setLyricsOpen(false); }} aria-label="Projects" title="Projects"><List size={17} /></button><div className={`volume-cluster ${volumeOpen ? "is-open" : ""}`}><span className="volume-slider"><input type="range" min="0" max="100" value={gain} style={{ "--seek": `${gain}%` } as CSSProperties} tabIndex={volumeOpen ? 0 : -1} aria-hidden={!volumeOpen} onChange={(event) => setGain(Number(event.target.value))} aria-label="Volume" /></span><button className={`glass-button ${volumeOpen ? "is-active" : ""}`} onClick={() => setVolumeOpen((open) => !open)} aria-label="Volume" title="Volume">{gain === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button></div></div></div>}


      {authOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setAuthOpen(false)}><div className="auth-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow">Local account</p><h2>{authMode === "login" ? "Welcome back" : "Create your account"}</h2><p>Your account stays on this device. No external service required.</p></div><button className="icon-button" onClick={() => setAuthOpen(false)}><X size={18} /></button></div>{user ? <><div className="account-badge"><UserRound size={17} /> Signed in as {user.email}</div><button className="save-button" onClick={async () => { await fetch("/api/auth", { method: "DELETE", credentials: "include" }); setUser(null); setAuthOpen(false); }}>Sign out</button></> : <form className="auth-form" onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const email = String(data.get("email") || "").trim().toLowerCase(); const password = String(data.get("password") || ""); const name = String(data.get("name") || email.split("@")[0] || "User"); setAuthError(""); try { const response = await fetch("/api/auth", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: authMode, email, password, name }) }); const payload = await response.json(); if (!response.ok) { setAuthError(payload.error || "Sign-in failed"); return; } setUser(payload.user); setAuthOpen(false); } catch { setAuthError("Could not reach the server — try again in a moment."); } }}><div className="auth-tabs"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}>Log in</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}>Register</button></div>{authMode === "register" && <label>Name<input name="name" placeholder="Your name" /></label>}<label>Email<input name="email" type="email" required placeholder="you@example.com" /></label><label>Password<input name="password" type="password" required minLength={6} placeholder="At least 6 characters" /></label>{authError && <p className="error-message">{authError}</p>}<button className="primary-button auth-submit" type="submit"><LockKeyhole size={15} /> {authMode === "login" ? "Log in" : "Create account"}</button></form>}</div></div>}

      {modalOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}><div className="upload-modal" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="eyebrow">Local import</p><h2>Bring media into the studio</h2><p>Files stay in this browser session until you choose to remove them.</p></div><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close upload dialog"><X size={18} /></button></div><div className={`dropzone ${dragging ? "dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={chooseFile}><div className="drop-icon"><Upload size={23} /></div><h3>Drop audio or video here</h3><p>or <span>browse files</span> from your computer — pick several at once to import a full album</p><small>Maximum file size: 250 MB</small></div>{error && <p className="error-message">{error}</p>}<div className="format-list"><strong>Accepted formats</strong><div>{acceptedFormats.map((format) => <span key={format}>{format}</span>)}</div></div><input ref={inputRef} type="file" accept={acceptedExtensions} onChange={onInput} multiple hidden /></div></div>}
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
    {visible && !failed && <video ref={videoRef} src={firstFrameUrl(item.url)} muted loop playsInline preload="metadata" onLoadedMetadata={(event) => showFirstFrame(event.currentTarget)} onError={() => setFailed(true)} />}
    {visible && failed && <span className="thumb-fallback"><FileVideo size={20} /><small>Preview unavailable in this browser</small></span>}
  </span>;
}

