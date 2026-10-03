"use client";

import { useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { FileVideo, Music2, SkipBack, SkipForward, Sparkles, Volume2, X } from "@/design-system/components/icons";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import { formatTime } from "@/shared/utilities/time";
import type { Asset } from "@/shared/types/media";

/**
 * The window-sized video player — never the browser's fullscreen API.
 *
 * The transport itself lives in the studio (the element it plays, whether it is playing, and the
 * order the rail offers), so those arrive as props and every control calls back. What this surface
 * owns is its own visibility: on a desk the dock is revealed by the pointer reaching the bottom
 * edge and hides itself again a moment later; on a phone there is no pointer to reach anything
 * with, so a tap on the picture is what raises it, a tap puts it away, and while the video runs it
 * goes on its own after the same moment. That timer is the only state here, and it is why the
 * overlay can be unmounted without the studio noticing.
 *
 * The rail is the studio's sidebar, re-lit for the playlist it is playing: same classes, same
 * glass — the pane the rim engine already knows. On a desk it slides out of the left edge under
 * the pointer; on a phone it hangs at the foot as a sheet, opened by the dock's list button, and a
 * tap outside it puts it away — the same pane in the shape the device can actually reach.
 */
export type VideoOverlayProps = {
  item: Asset;
  media: RefObject<HTMLVideoElement>;
  playing: boolean;
  progress: number;
  duration: number;
  /** Everything the rail can play: songs and clips alike. */
  playable: Asset[];
  user: { email: string; name: string } | null;
  /** The phone layout: tap-driven controls and the playlist as a sheet. */
  compact: boolean;
  onProgress: (seconds: number) => void;
  onDuration: (seconds: number) => void;
  onPlayingChange: (playing: boolean) => void;
  onSelect: (item: Asset) => void;
  onHoverItem: (item: Asset) => void;
  onLeaveItem: () => void;
  onRequestAuth: () => void;
  onClose: () => void;
};

/** How long the dock stays up after the last time the pointer touched the bottom edge. */
const HIDE_AFTER_MS = 1800;

export default function VideoOverlay({
  item, media, playing, progress, duration, playable, user, compact,
  onProgress, onDuration, onPlayingChange, onSelect, onHoverItem, onLeaveItem, onRequestAuth, onClose,
}: VideoOverlayProps) {
  /** Whether the dock is up: the pointer reaching the bottom edge, or a tap, is what raises it. */
  const [controlsVisible, setControlsVisible] = useState(false);
  const [hideTimer, setHideTimer] = useState<number | null>(null);
  /** The phone's name card, which the round video icon opens above the dock. */
  const [nameOpen, setNameOpen] = useState(false);

  function hideDock() {
    if (hideTimer) window.clearTimeout(hideTimer);
    setHideTimer(null);
    setNameOpen(false);
    setControlsVisible(false);
  }

  /** Raises the dock; `autoHide` is off while the video is paused, when the eye is on its controls. */
  function revealDock(autoHide: boolean) {
    setControlsVisible(true);
    if (hideTimer) window.clearTimeout(hideTimer);
    setHideTimer(autoHide ? window.setTimeout(hideDock, HIDE_AFTER_MS) : null);
  }

  function keepVisible() { revealDock(true); }
  function hideSoon() { hideDock(); }

  /**
   * A finger has no way to reach the bottom edge and no hover to keep the dock alive: a tap on the
   * picture is the whole of the grammar. It toggles the dock, and a dock that arrives by tap
   * lingers while the video is paused and takes itself away after the same moment while it runs.
   */
  function toggleDock() {
    if (controlsVisible) { hideDock(); return; }
    revealDock(playing);
  }

  /** A tap that landed on the picture rather than on a control: the name card first, then the dock. */
  function onSurfaceClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!compact) return;
    const target = event.target as HTMLElement;
    if (target.closest(".video-player-dock,.video-shell-sidebar")) return;
    if (nameOpen) { setNameOpen(false); return; }
    toggleDock();
  }

  function seekBy(seconds: number) {
    const video = media.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(Number.isFinite(video.duration) ? video.duration : Infinity, video.currentTime + seconds));
  }

  return (
    <div
      className={`video-overlay ${controlsVisible ? "video-controls-visible" : ""}`}
      /* The layer marker the ink sampler reads: an overlay is a scene of its own, and its panes
         (and the ones painting above it) are judged against it rather than against the page. */
      data-glass-layer="video"
      onMouseMove={compact ? undefined : (event) => {
        const nearBottom = window.innerHeight - event.clientY < 150;
        if (nearBottom) keepVisible();
        else if (!event.currentTarget.querySelector(".video-player-dock:hover")) setControlsVisible(false);
      }}
      onMouseLeave={compact ? undefined : hideSoon}
      onClick={onSurfaceClick}
    >
      <video ref={media} src={item.url} autoPlay playsInline
        onPlay={() => onPlayingChange(true)} onPause={() => onPlayingChange(false)}
        onLoadedMetadata={(event) => onDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => onProgress(event.currentTarget.currentTime)} />
      <div className="video-shell-sidebar">
        <aside className="sidebar" data-glass-edge="" data-glass-scene="moving-media">
          {/* Same rail styling as the main sidebar, but listing the media you can play. */}
          <div className="brand"><div className="brand-mark"><Sparkles size={17} /></div><span>onlineMusic</span></div>
          <nav className="nav-group video-playlist">
            <p className="eyebrow">Songs &amp; videos</p>
            {playable.map((entry) => (
              <button className={`nav-item ${item.file.name === entry.file.name ? "active" : ""}`} key={entry.file.name}
                onClick={() => onSelect(entry)} onPointerEnter={() => onHoverItem(entry)} onPointerLeave={onLeaveItem}>
                {entry.kind === "video" ? <FileVideo size={16} /> : <Music2 size={16} />}
                <span className="playlist-title">{entry.title || entry.file.name}</span>
              </button>
            ))}
            {playable.length === 0 && <p className="playlist-empty">Nothing to play yet.</p>}
          </nav>
          <div className="sidebar-bottom">
            <button className="profile profile-button" onClick={onRequestAuth}>
              <div className="avatar">{user?.name?.slice(0, 2).toUpperCase() || "JL"}</div>
              <div><strong>{user?.name || "Guest user"}</strong><small>{user ? user.email : "Sign in to sync"}</small></div>
            </button>
          </div>
        </aside>
      </div>
      <div className={`video-dock-hit-zone ${controlsVisible ? "is-visible" : ""}`}
        onMouseEnter={compact ? undefined : () => setControlsVisible(true)}
        onMouseLeave={compact ? undefined : () => setHideTimer(window.setTimeout(() => setControlsVisible(false), 250))}>
        <div className={`video-player-dock ${controlsVisible ? "is-visible" : ""}`} data-glass-edge="" data-glass-scene="moving-media">
          <div className="now-playing">
            {/* On a phone the tile turns into a round button that opens the name above the row; on a
                desk it is the label's own artwork and nothing else. */}
            {compact
              ? <button className={`mini-cover ${nameOpen ? "is-open" : ""}`} onClick={() => setNameOpen((open) => !open)} aria-expanded={nameOpen} aria-label="Song details"><FileVideo size={16} /></button>
              : <span className="mini-cover"><FileVideo size={16} /></span>}
            {/* On the phone the words leave the row and become a pane of their own above it — the
                ink sampler reads runs against their own pane's box, so a label hanging outside the
                dock's box has to carry the marker to be inked at all. */}
            <div className={`now-playing-copy ${nameOpen ? "is-open" : ""}`} data-glass-edge={compact ? "" : undefined} data-glass-scene={compact ? "moving-media" : undefined}><strong><span>{item.title || item.file.name}</span></strong><small>video · local preview</small></div>
          </div>
          <div className="player-controls">
            <button className="icon-button" onClick={() => seekBy(-10)} aria-label="Back 10 seconds"><SkipBack size={16} /></button>
            <button className="player-button" onClick={() => { const video = media.current; if (!video) return; if (video.paused) void video.play(); else video.pause(); }} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseGlyph size={24} /> : <PlayGlyph size={24} />}</button>
            <button className="icon-button" onClick={() => seekBy(10)} aria-label="Forward 10 seconds"><SkipForward size={16} /></button>
            <div className="progress-wrap">
              <span>{formatTime(progress)}</span>
              <input type="range" min="0" max={duration || 1} step="0.1" value={progress}
                style={{ "--seek": `${duration ? (progress / duration) * 100 : 0}%` } as CSSProperties}
                onChange={(event) => { const value = Number(event.target.value); const video = media.current; if (video) video.currentTime = value; onProgress(value); }} aria-label="Seek" />
              <span>{formatTime(duration)}</span>
            </div>
          </div>
          <div className="player-actions">
            <Volume2 size={17} />
            <input type="range" min="0" max="100" defaultValue="100" aria-label="Volume"
              onChange={(event) => { const video = media.current; if (video) video.volume = Number(event.target.value) / 100; }} />
            <button className="queue-button" onClick={onClose} aria-label="Close video"><X size={16} /> <span>Close</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}
