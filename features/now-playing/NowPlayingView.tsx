"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { List, MessageSquareQuote, Music2, Repeat, Shuffle, SkipBack, SkipForward, Volume2, VolumeX, X } from "lucide-react";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import { SeekBar } from "@/features/player";
import { coverSrc } from "@/shared/utilities/media";
import type { Asset } from "@/shared/types/media";

/**
 * The full-window now-playing view — an in-app surface, never the browser's fullscreen API.
 *
 * What the *studio* owns is the song: the transport, the queue it walks and the artwork's colour
 * arrive as props, and every control here calls back into them. What this view owns is everything
 * about being looked at: which right-hand panel is showing, whether the disclosure is open, where
 * the phone's swipe has dragged the sheet to, and the lyric focus that falls off with distance
 * from the middle of the sheet. That state used to live in the page, which meant the page had to
 * know about gestures and artwork slots to render a view nobody could see yet — it now lives here,
 * which is also why this surface can be loaded on demand.
 */
export type NowPlayingViewProps = {
  /** The song the transport is on, if one is loaded — the view opens onto an empty stage otherwise. */
  track: Asset | null;
  /** Its artwork, if it has any. */
  cover: string;
  /** The song's words, already stripped of their LRC stamps. */
  lyrics: string[];
  /** The songs that follow, and the order the transport walks them in. */
  queue: Asset[];
  queueNames: string[];
  playing: boolean;
  /** True for the length of the play disc's swell. */
  playStarting: boolean;
  gain: number;
  canStep: boolean;
  shuffleOn: boolean;
  loopOn: boolean;
  /** The artwork's colour as "r g b", for the backdrop. */
  tint: string;
  /** True for the length of the fall animation, so the view can leave before it unmounts. */
  closing: boolean;
  compact: boolean;
  media: RefObject<HTMLMediaElement | null>;
  onClosed: () => void;
  onClose: () => void;
  onTogglePlayback: () => void;
  onToggleMute: () => void;
  onGain: (value: number) => void;
  onStep: (direction: 1 | -1) => void;
  onToggleShuffle: () => void;
  onToggleLoop: () => void;
  onPick: (item: Asset) => void;
};

export default function NowPlayingView({
  track, cover, lyrics, queue, queueNames, playing, playStarting, gain, canStep, shuffleOn, loopOn,
  tint, closing, compact, media, onClosed, onClose, onTogglePlayback, onToggleMute, onGain, onStep,
  onToggleShuffle, onToggleLoop, onPick,
}: NowPlayingViewProps) {
  const [panel, setPanel] = useState<"queue" | "lyrics">("queue");
  /**
   * The right column is the corner switch's disclosure: the switch holding focus is what keeps the
   * panel open, and the moment focus leaves it the column gives its width back to the stage — which
   * is what puts the transport back in the middle of the window. The lit disc belongs to that held
   * state and goes with it, so a view nobody is pointing at shows two plain icons and no selection
   * at all — a click on the empty glass then leaves nothing behind, neither panel nor highlight.
   */
  const [drawer, setDrawer] = useState(false);
  /** Live progress of the small screen's lyrics gesture, 0 at rest and 1 fully open. */
  const [reveal, setReveal] = useState(0);
  const [axis, setAxis] = useState<"x" | "y" | null>(null);

  const lyricsRef = useRef<HTMLDivElement>(null);
  /** The phone's words, which stand in the artwork's slot instead of in a sheet of their own. */
  const wordsRef = useRef<HTMLDivElement>(null);
  /** The artwork's slot itself, whose distance from the top of the window sizes that space. */
  const artWrapRef = useRef<HTMLDivElement>(null);
  /** The song's title, whose top edge is where the player block begins. */
  const titlesRef = useRef<HTMLDivElement>(null);
  const lyricFrame = useRef(0);

  // The sheet and the artwork are one position: whatever opens or closes the drawer — the swipe,
  // Escape, focus landing on a row — the artwork steps out or comes back with it.
  useEffect(() => { setReveal(drawer ? 1 : 0); }, [drawer]);

  // Escape unwinds one layer at a time: the lyrics sheet first, the view itself after.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (drawer && compact) { setDrawer(false); setReveal(0); return; }
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawer, compact, onClose]);

  /**
   * The fullscreen lyrics are read through a focus: the line nearest the middle of the sheet is the
   * sharp one, and the words soften as they run away from it, so the page reads as a column of light
   * rather than a wall of text. Each line carries its own `--lyric-focus` (1 at the centre, 0 at the
   * sheet's edge) and the stylesheet turns that into a blur — the panel behind them stays plain,
   * which is the whole point of doing it on the words.
   */
  function paintLyrics() {
    lyricFrame.current = 0;
    const sheet = wordsRef.current ?? lyricsRef.current;
    if (!sheet) return;
    // The phone's words are read in the upper space as a whole rather than inside the artwork's own
    // box: the slot plus the room the centred column leaves above it. That room moves with the
    // window, so it is measured here, where the layout is being read anyway, and the stylesheet
    // does the centring with it.
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
   * the room from the slot's bottom down to the block. Nothing is guessed, because the slot's place
   * is whatever the window and the title leave it; the stylesheet only does the arithmetic.
   */
  useEffect(() => {
    if (!compact) return;
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
  }, [compact, panel, lyrics.length]);

  useEffect(() => {
    const sheet = wordsRef.current ?? lyricsRef.current;
    if (!sheet || panel !== "lyrics") return;
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
  }, [panel, lyrics.length, compact]);

  /**
   * The small screen's way to the lyrics. The sheet is a position rather than a switch: a downward
   * drag anywhere on the stage that is not a control brings it up, and on the artwork a leftward
   * drag does the same, carrying the artwork out of the window with it. Once it is up, a rightward
   * drag on the stage pulls it back down and brings the artwork back in. The axis is locked in the
   * first few pixels, so a scroll intent and a sideways swipe never fight, and the pointer is only
   * captured once an axis is committed — capturing on the way down would swallow the progress
   * slider's own drag.
   */
  const gesture = useRef<{ pointer: number; x: number; y: number; axis: "x" | "y" | null; onArt: boolean; from: number; time: number } | null>(null);

  function onGestureStart(event: ReactPointerEvent<HTMLElement>) {
    if (!compact) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,button,.now-progress,.now-transport,.now-drawer")) return;
    gesture.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, axis: null, onArt: Boolean(target.closest(".now-art-wrap")), from: drawer ? 1 : reveal, time: performance.now() };
  }

  function onGestureMove(event: ReactPointerEvent<HTMLElement>) {
    const state = gesture.current;
    if (!state || event.pointerId !== state.pointer) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      setAxis(state.axis);
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is already gone */ }
    }
    // Only the direction that moves the sheet towards where it already is counts: down and to the
    // left bring it up, to the right puts it back, and a drag the other way is simply held still.
    const travel = state.axis === "y" ? Math.max(0, dy) : state.from > 0.5 ? -Math.max(0, dx) : state.onArt ? Math.max(0, -dx) : 0;
    setReveal(Math.max(0, Math.min(1, state.from + travel / 220)));
  }

  function onGestureEnd(event: ReactPointerEvent<HTMLElement>) {
    const state = gesture.current;
    gesture.current = null;
    if (!state) return;
    setAxis(null);
    // A tap while the sheet is up puts it away again, wherever it landed.
    if (!state.axis) {
      if (drawer) setDrawer(false);
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
    setReveal(open ? 1 : 0);
    if (open) { setPanel("lyrics"); setDrawer(true); }
    else setDrawer(false);
  }

  return (
    <section
      className={`now-view ${tint ? "has-tint" : ""} ${closing ? "is-closing" : ""}`}
      onAnimationEnd={(event) => { if (event.target === event.currentTarget && closing) onClosed(); }}
      style={tint ? ({ "--np-tint": tint } as CSSProperties) : undefined}
      aria-label="Now playing"
    >
      <div className="now-backdrop" aria-hidden="true" />
      <header className="now-head">
        <button className="now-close" onClick={onClose} aria-label="Close now playing" title="Close"><X size={18} /></button>
        <p className="now-kicker">Now playing</p>
        <div className="now-volume">
          <input type="range" min="0" max="100" value={gain} style={{ "--seek": `${gain}%` } as CSSProperties} onChange={(event) => onGain(Number(event.target.value))} aria-label="Volume" />
          <button className="now-volume-icon" onClick={onToggleMute} aria-label={gain === 0 ? "Unmute" : "Mute"} title={gain === 0 ? "Unmute" : "Mute"}>{gain === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}</button>
        </div>
      </header>
      <div className={`now-body ${drawer ? "is-drawer-open" : "is-drawer-closed"}`}>
        <div className={`now-stage ${axis ? "is-dragging" : ""}`} style={{ "--now-reveal": String(reveal) } as CSSProperties}
          onPointerDown={onGestureStart} onPointerMove={onGestureMove} onPointerUp={onGestureEnd}
          onPointerCancel={() => { gesture.current = null; setAxis(null); }}>
          <div className="now-art-wrap" ref={artWrapRef}>
            <div className={`now-art ${track && cover ? "" : "is-empty"}`}>{track && cover ? <img src={cover} alt="" /> : <Music2 size={72} />}</div>
            {compact && panel === "lyrics" && <div className="now-lyrics now-words" ref={wordsRef}>{lyrics.map((line, index) => <p key={index}>{line}</p>)}{lyrics.length === 0 && <p className="now-empty">No lyrics for this song yet.</p>}</div>}
          </div>
          <div className="now-titles" ref={titlesRef}><h2>{track ? track.title || track.file.name : "Not Playing"}</h2></div>
          <div className="now-progress"><SeekBar media={media} remaining disabled={!track} ariaLabel="Seek" /></div>
          <div className="now-transport">
            <button className={`transport-extra ${shuffleOn ? "is-on" : ""}`} onClick={onToggleShuffle} disabled={!canStep} aria-label="Shuffle" aria-pressed={shuffleOn} title="Shuffle"><Shuffle size={19} /></button>
            <button className="transport-step" onClick={() => onStep(-1)} disabled={!canStep} aria-label="Previous song" title="Previous"><SkipBack size={24} fill="currentColor" /></button>
            <button className={`now-play ${playStarting ? "is-starting" : ""}`} onClick={onTogglePlayback} disabled={!track} aria-label={track && playing ? "Pause" : "Play"}>{playing && track ? <PauseGlyph size={40} /> : <PlayGlyph size={40} />}</button>
            <button className="transport-step" onClick={() => onStep(1)} disabled={!canStep} aria-label="Next song" title="Next"><SkipForward size={24} fill="currentColor" /></button>
            <button className={`transport-extra ${loopOn ? "is-on" : ""}`} onClick={onToggleLoop} disabled={!canStep} aria-label="Repeat list" aria-pressed={loopOn} title="Repeat list"><Repeat size={19} /></button>
          </div>
        </div>
        {!compact && <div className="now-drawer" onFocus={() => setDrawer(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDrawer(false); }}>
          <aside className={`now-queue ${panel === "lyrics" ? "is-lyrics" : ""}`}>
            {panel === "queue" && <header><div className="now-queue-copy"><h3>Continue playing</h3><p>{track?.album ? `From ${track.album}` : "From all songs"}</p></div></header>}
            {panel === "lyrics"
              ? <div className="now-lyrics" ref={lyricsRef}>{lyrics.map((line, index) => <p key={index}>{line}</p>)}{lyrics.length === 0 && <p className="now-empty">No lyrics for this song yet.</p>}</div>
              : <ol>
                {queue.map((item) => <li key={item.file.name}><button className={`now-row ${item.file.name === track?.file.name ? "is-current" : ""}`} onClick={() => onPick(item)}><span className="now-row-art">{coverSrc(item) ? <img src={coverSrc(item)} alt="" loading="lazy" decoding="async" /> : <Music2 size={14} />}</span><span className="now-row-copy"><strong>{item.title || item.file.name}</strong><small>{[item.artist, item.album].filter(Boolean).join(" — ") || "Unknown artist"}</small></span></button></li>)}
                {queue.length === 0 && <li className="now-empty">Nothing else in this project yet.</li>}
              </ol>}
          </aside>
          <div className="now-switch" role="tablist" aria-label="Right panel">
            <button role="tab" aria-selected={drawer && panel === "lyrics"} className={drawer && panel === "lyrics" ? "is-on" : ""} onClick={() => { setPanel("lyrics"); setDrawer(true); }} aria-label="Lyrics" title="Lyrics"><MessageSquareQuote size={17} /></button>
            <button role="tab" aria-selected={drawer && panel === "queue"} className={drawer && panel === "queue" ? "is-on" : ""} onClick={() => { setPanel("queue"); setDrawer(true); }} aria-label="Continue playing" title="Continue playing"><List size={17} /></button>
          </div>
        </div>}
      </div>
    </section>
  );
}
