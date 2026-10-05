"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { ArrowLeft, Download, FileUp, Plus, Redo2, Undo2 } from "@/design-system/components/icons";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import { RangeControl } from "@/design-system/components/RangeControl";
import { SeekBar } from "@/features/player";
import { ApiError } from "@/infrastructure/api/client";
import {
  addLine, hasTiming, mergeTokens, moveLine, moveToken, parseLyrics, setLineSpan, setTokenSpan, shiftAll, toJson, toLrc, tokenizeAllLines, tokenizeLineAt, type LyricsDoc,
} from "@/shared/lyrics";
import type { Asset } from "@/shared/types/media";
import { saveLyricsDoc } from "./client";
import PlaybackLyrics from "./PlaybackLyrics";
import EditorRow from "./EditorRow";
import { parseStamp, stampText } from "./format";
import "./lyrics.css";

/**
 * The standalone lyrics workspace: the whole window, its own header and its own undo history,
 * exactly as separate from the player as the parameter editor is. It works on one document and
 * hands it back through `onSaved`, so the playback page starts using the new words the moment
 * they land — no reload, no second copy of the lyrics logic anywhere.
 *
 * The window is two columns: the sentences, with their words nested under them, on the left; the
 * live renderer and the tape (play, clock, speed, offset) on the right. There is no waveform —
 * the words are the timeline, sentence by sentence, word by word. The speed dial is the
 * workspace's own (0.3×–2×, opening at 1.0) and is given back when it closes.
 *
 * The shortcuts follow a timing workflow: Space rolls the tape, Enter stamps the boundary under
 * the playhead, the arrows nudge by 1/10/100 ms, and the up and down keys walk the words.
 */
export type LyricsEditorProps = {
  asset: Asset;
  doc: LyricsDoc;
  media: RefObject<HTMLMediaElement | null>;
  playing: boolean;
  onTogglePlayback: () => void;
  onSaved: (doc: LyricsDoc) => void;
  onClose: () => void;
};

type Pending = { message: string; confirm: string; run: () => void };

/**
 * The transport's clock, read straight from the element — no React state per frame. The elapsed
 * side is a field: type `m:ss.mmm` (or plain seconds, the same grammar the word fields take) and
 * the playhead goes there. The duration stays a readout. The running clock leaves the field alone
 * while it is being typed into and re-syncs the moment it is let go.
 */
function TimeReadout({ media }: { media: RefObject<HTMLMediaElement | null> }) {
  const clock = useRef<HTMLInputElement>(null);
  const total = useRef<HTMLSpanElement>(null);
  const typing = useRef(false);
  useEffect(() => {
    const found = media.current;
    if (!found) return;
    const audio = found;
    let frame = 0;
    const place = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (total.current) total.current.textContent = stampText(duration);
      if (clock.current && !typing.current) clock.current.value = stampText(audio.currentTime);
    };
    const start = () => { if (!frame) frame = window.requestAnimationFrame(tick); };
    function tick() {
      frame = 0;
      place();
      if (!audio.paused) start();
    }
    place();
    audio.addEventListener("play", start);
    audio.addEventListener("seeking", place);
    audio.addEventListener("seeked", place);
    audio.addEventListener("loadedmetadata", place);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      audio.removeEventListener("play", start);
      audio.removeEventListener("seeking", place);
      audio.removeEventListener("seeked", place);
      audio.removeEventListener("loadedmetadata", place);
    };
  }, [media]);

  /** Moves the playhead where the stamp says; false when the text cannot be read. */
  function seekTo(draft: string): boolean {
    const audio = media.current;
    const parsed = parseStamp(draft);
    if (!audio || parsed === null) return false;
    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    audio.currentTime = duration > 0 ? Math.min(parsed, Math.max(0, duration - 0.05)) : parsed;
    return true;
  }

  return (
    <span className="lxe-clock">
      <input ref={clock} className="lxe-clock-input" data-transport-space="" inputMode="decimal"
        aria-label="Playhead position" title="Type a position — m:ss.mmm, or seconds"
        onFocus={(event) => { typing.current = true; const audio = media.current; if (audio) event.currentTarget.value = stampText(audio.currentTime); event.currentTarget.select(); }}
        onBlur={(event) => { typing.current = false; seekTo(event.currentTarget.value); const audio = media.current; if (audio) event.currentTarget.value = stampText(audio.currentTime); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          // Enter seeks and stays: the field keeps the caret so another stamp can follow, and the
          // key never reaches the editor's own Enter, which stamps the selected word.
          event.preventDefault();
          event.stopPropagation();
          if (seekTo(event.currentTarget.value)) { const audio = media.current; if (audio) event.currentTarget.value = stampText(audio.currentTime); }
        }} />
      <span aria-hidden="true"> / </span>
      <span ref={total} />
    </span>
  );
}

export default function LyricsEditor({ asset, doc: initialDoc, media, playing, onTogglePlayback, onSaved, onClose }: LyricsEditorProps) {
  const [doc, setDoc] = useState<LyricsDoc>(initialDoc);
  const docRef = useRef(doc);
  docRef.current = doc;
  /** The last document the server acknowledged; identity compare is the dirty flag. */
  const savedRef = useRef(initialDoc);
  const dirty = doc !== savedRef.current;

  const [selection, setSelection] = useState({ line: 0, token: -1 });
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  /** The drag-selected token range — what Enter merges — and the interval being auditioned. */
  const [range, setRange] = useState<{ line: number; from: number; to: number } | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [playingRange, setPlayingRange] = useState<{ start: number; end: number } | null>(null);
  const intervalRef = useRef<{ start: number; end: number } | null>(null);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const select = useCallback((line: number, token: number) => {
    setSelection({ line, token });
    setRange(null);
  }, []);

  /**
   * The first step of the timing workflow: when the document has no timing at all, the editor
   * opens on a paste step — the full lyrics in, one line per sentence, words cut automatically.
   * Skip leaves whatever is there (a tag import, an empty table) untouched.
   */
  const [intro, setIntro] = useState(() => !hasTiming(initialDoc));
  const introRef = useRef(intro);
  introRef.current = intro;
  const [introText, setIntroText] = useState(() => initialDoc.lines.map((line) => line.text).join("\n"));

  /**
   * The workspace's own tape speed — 0.3× to 2×, always opening at 1.0 — so a line can be timed
   * without hearing it at full tilt. It is the editor's instrument, not a setting: the studio's
   * own rate (its 0.5–1.5× slider) is captured when the workspace opens and put back when it
   * closes, so slow timing never survives into playback.
   */
  const [speed, setSpeed] = useState(1);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const restoreRate = useRef<number | null>(null);
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    if (restoreRate.current === null) restoreRate.current = element.playbackRate;
    try { element.playbackRate = speed; } catch { /* Safari refuses a rate change before metadata */ }
  }, [media, speed]);
  // The restore lives in its own effect: a cleanup on the effect above would run on every slider
  // move and briefly hand the element back to the studio's rate.
  useEffect(() => {
    const element = media.current;
    return () => {
      if (element && restoreRate.current !== null) element.playbackRate = restoreRate.current;
      restoreRate.current = null;
    };
  }, [media]);
  // A changed src — an auto-advance at the end of a song — resets playbackRate, and the Safari
  // refusal above means the write may have been dropped; loadedmetadata is where both are healed.
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const reapply = () => { try { element.playbackRate = speedRef.current; } catch { /* not ready yet */ } };
    element.addEventListener("loadedmetadata", reapply);
    return () => element.removeEventListener("loadedmetadata", reapply);
  }, [media]);

  const historyRef = useRef<{ past: LyricsDoc[]; future: LyricsDoc[] }>({ past: [], future: [] });
  const coalesce = useRef<{ key: string; at: number } | null>(null);
  const [, bumpHistory] = useReducer((count: number) => count + 1, 0);

  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const [offsetMs, setOffsetMs] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  const playhead = useCallback(() => media.current?.currentTime ?? 0, [media]);
  const fallbackDuration = useMemo(() => {
    const stored = Number(asset.metadata.durationMs);
    return Number.isFinite(stored) && stored > 0 ? stored / 1000 : 0;
  }, [asset.metadata.durationMs]);
  const duration = useMemo(() => {
    const element = media.current;
    const live = element && Number.isFinite(element.duration) ? element.duration : 0;
    return live > 0 ? live : fallbackDuration;
  }, [media, fallbackDuration, doc, playing]);

  /**
   * Every change is a new document and, unless it continues a burst of typing inside the same
   * field, a new undo entry. The coalescing window is what keeps a typed line one undo away
   * rather than one keystroke away.
   */
  const apply = useCallback((next: LyricsDoc | null, key?: string) => {
    if (!next) return;
    const history = historyRef.current;
    const now = performance.now();
    const continues = key !== undefined && coalesce.current !== null && coalesce.current.key === key && now - coalesce.current.at < 600;
    if (!continues) {
      history.past.push(docRef.current);
      if (history.past.length > 120) history.past.shift();
    }
    history.future = [];
    coalesce.current = key !== undefined ? { key, at: now } : null;
    setDoc(next);
    bumpHistory();
  }, []);

  const undo = useCallback(() => {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) return;
    history.future.push(docRef.current);
    coalesce.current = null;
    setDoc(previous);
    bumpHistory();
  }, []);

  const redo = useCallback(() => {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) return;
    history.past.push(docRef.current);
    coalesce.current = null;
    setDoc(next);
    bumpHistory();
  }, []);

  /**
   * Audition one interval — a sentence's span or a single word's. It plays through the page's own
   * transport state (never `element.play()`), so the whole studio agrees on what is playing, and
   * a rAF watch pauses it again at the interval's end. Clicking the same interval toggles.
   */
  const cancelInterval = useCallback(() => {
    intervalRef.current = null;
    setPlayingRange(null);
  }, []);

  const playRange = useCallback((start: number, end: number) => {
    const element = media.current;
    if (!element || end <= start) return;
    const armed = intervalRef.current;
    if (playingRef.current && armed && armed.start === start && armed.end === end) {
      cancelInterval();
      onTogglePlayback();
      return;
    }
    element.currentTime = start;
    intervalRef.current = { start, end };
    setPlayingRange({ start, end });
    if (!playingRef.current || element.paused) onTogglePlayback();
  }, [media, onTogglePlayback, cancelInterval]);

  useEffect(() => {
    const element = media.current;
    const target = intervalRef.current;
    if (!element || !target || !playing) return;
    let frame = 0;
    let timer = 0;
    let stopped = false;
    // Pause the element itself first: routing the stop through React state would let the tape run
    // on for the length of a render, audible as a word bleeding into its neighbour. The toggle
    // then only brings the studio's state in line.
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelInterval();
      if (!element.paused) {
        element.pause();
        if (playingRef.current) onTogglePlayback();
      }
    };
    const check = () => {
      if (element.currentTime >= target.end) { stop(); return true; }
      // A seek that left the interval entirely is the user taking over; stand the audition down.
      if (element.currentTime < target.start - 0.05) { cancelInterval(); return true; }
      return false;
    };
    // rAF is frame-accurate while the window is visible; the timer poll keeps the stop honest
    // when rAF is throttled in a background or occluded window, where a frame can be 100 ms away.
    frame = window.requestAnimationFrame(function tick() {
      frame = 0;
      if (check()) return;
      frame = window.requestAnimationFrame(tick);
    });
    const beat = () => {
      timer = 0;
      if (check()) return;
      timer = window.setTimeout(beat, 30);
    };
    timer = window.setTimeout(beat, 30);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
    };
  }, [media, playing, playingRange, cancelInterval, onTogglePlayback]);

  useEffect(() => {
    if (!playing && intervalRef.current) cancelInterval();
  }, [playing, cancelInterval]);

  /** Enter on a drag-selected range: the words become one, span and all. */
  const mergeRange = useCallback((line: number, from: number, to: number) => {
    setRange(null);
    apply(mergeTokens(docRef.current, line, from, to));
    setSelection({ line, token: from });
  }, [apply]);

  async function save() {
    if (!asset.apiId || saving === "saving") return;
    setSaving("saving");
    setError("");
    try {
      const stored = await saveLyricsDoc(asset.apiId, docRef.current);
      savedRef.current = stored;
      setDoc(stored);
      setSaving("saved");
      onSaved(stored);
      window.setTimeout(() => setSaving((current) => (current === "saved" ? "idle" : current)), 2000);
    } catch (failure) {
      setSaving("idle");
      setError(failure instanceof ApiError && !failure.isNetwork ? failure.message : "Could not save — try again in a moment.");
    }
  }

  /**
   * Enter: stamp the boundary under the playhead. A line without words is timed at the line level
   * first and tokenized on the third press; a line whose words exist — timed or not — is timed
   * word by word: the first press opens the word, the second closes it and opens the next, and
   * the line's own span follows its first start and its last end.
   */
  const stamp = useCallback(() => {
    const current = docRef.current;
    const time = playhead();
    let { line: lineIndex, token } = selectionRef.current;
    if (current.lines.length === 0) {
      apply(addLine(current, 0, ""));
      return;
    }
    lineIndex = Math.min(Math.max(0, lineIndex), current.lines.length - 1);
    const line = current.lines[lineIndex];
    if (!line.tokens?.length) {
      if (line.start === undefined) {
        apply(setLineSpan(current, lineIndex, { start: time }));
        return;
      }
      if (line.end === undefined) {
        const ended = setLineSpan(current, lineIndex, { end: Math.max(time, line.start + 0.05) });
        apply(ended);
        return;
      }
      apply(tokenizeLineAt(current, lineIndex));
      select(lineIndex, 0);
      return;
    }
    if (token < 0) token = 0;
    const last = line.tokens.length - 1;
    token = Math.min(token, last);
    const entry = line.tokens[token];
    if (typeof entry.start !== "number") {
      let opened = setTokenSpan(current, lineIndex, token, { start: time });
      if (typeof line.start !== "number") opened = setLineSpan(opened, lineIndex, { start: time });
      apply(opened);
      return;
    }
    if (typeof entry.end !== "number") {
      const end = Math.max(time, entry.start + 0.05);
      let closed = setTokenSpan(current, lineIndex, token, { end });
      if (token < last) closed = setTokenSpan(closed, lineIndex, token + 1, { start: end });
      else if (typeof line.end !== "number") closed = setLineSpan(closed, lineIndex, { end });
      apply(closed);
      if (token < last) select(lineIndex, token + 1);
      else if (lineIndex < current.lines.length - 1) select(lineIndex + 1, -1);
      return;
    }
    let next = setTokenSpan(current, lineIndex, token, { end: time });
    if (token < last) next = setTokenSpan(next, lineIndex, token + 1, { start: time });
    else next = setLineSpan(next, lineIndex, { end: Math.max(time, line.end ?? time) });
    apply(next);
    if (token < last) select(lineIndex, token + 1);
    else if (lineIndex < current.lines.length - 1) select(lineIndex + 1, -1);
  }, [apply, playhead, select]);

  /** ← / → move the selected token (or the whole line); Shift and Alt change the step. */
  const nudge = useCallback((delta: number) => {
    const current = docRef.current;
    const { line, token } = selectionRef.current;
    const entry = current.lines[line];
    if (!entry) return;
    const key = `nudge:${line}:${token}`;
    if (token >= 0 && entry.tokens?.[token]) apply(moveToken(current, line, token, delta), key);
    else apply(moveLine(current, line, delta), key);
  }, [apply]);

  /** ↑ / ↓ walk the tokens, crossing into the neighbouring line at the ends. */
  const stepToken = useCallback((direction: 1 | -1) => {
    const current = docRef.current;
    let { line, token } = selectionRef.current;
    if (!current.lines.length) return;
    line = Math.min(Math.max(0, line), current.lines.length - 1);
    const count = current.lines[line].tokens?.length ?? 0;
    if (count === 0) {
      select(line, -1);
      return;
    }
    if (token < 0) { select(line, direction === 1 ? 0 : count - 1); return; }
    const next = token + direction;
    if (next >= 0 && next < count) { select(line, next); return; }
    let neighbour = line + direction;
    while (neighbour >= 0 && neighbour < current.lines.length && !(current.lines[neighbour].tokens?.length)) neighbour += direction;
    if (neighbour < 0 || neighbour >= current.lines.length) return;
    const neighbourCount = current.lines[neighbour].tokens?.length ?? 0;
    select(neighbour, direction === 1 ? 0 : neighbourCount - 1);
  }, [select]);

  // The keyboard is the editor's own; the page's transport key stands down while it is open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      // A focused slider is not a text field: the transport keys still work (the page's own rule),
      // or the editor would go dead every time the pointer touched the seek or speed slider. Its
      // arrows stay the slider's, though — nudging a stamp is for when the words have the focus.
      const onSlider = target instanceof HTMLInputElement && target.type === "range";
      const typing = (target instanceof HTMLInputElement && !onSlider)
        || target instanceof HTMLTextAreaElement
        || (target instanceof HTMLElement && target.isContentEditable);
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
        return;
      }
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
        return;
      }
      // Space is the transport key even in a time field: a stamp is typed as `m:ss.mmm` and a
      // space is never part of one, so the one key that starts and stops the song should not go
      // dead just because the pointer last touched a time box. The field is blurred on the way
      // through — that commits the draft and leaves no ring behind.
      if ((event.key === " " || event.code === "Space") && target instanceof HTMLInputElement && target.hasAttribute("data-transport-space")) {
        event.preventDefault();
        target.blur();
        onTogglePlayback();
        return;
      }
      if (typing) return;
      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
        onTogglePlayback();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selected = rangeRef.current;
        if (selected) mergeRange(selected.line, selected.from, selected.to);
        else stamp();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (onSlider) return;
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const step = event.altKey ? 0.001 : event.shiftKey ? 0.1 : 0.01;
        event.preventDefault();
        nudge(direction * step);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (onSlider) return;
        event.preventDefault();
        stepToken(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Escape backs out one layer at a time: the paste step, then a token range, then the editor.
        if (introRef.current) { setIntro(false); return; }
        if (rangeRef.current) { setRange(null); return; }
        requestClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, mergeRange, nudge, stepToken, undo, redo, onTogglePlayback, onClose, dirty]);

  // The selection follows the keyboard: whatever row or chip holds it comes into view.
  useEffect(() => {
    const rows = rowsRef.current;
    if (!rows) return;
    const row = rows.querySelector<HTMLElement>(`[data-lxe-row="${selection.line}"]`);
    row?.scrollIntoView({ block: "nearest" });
    const chip = row?.querySelectorAll<HTMLElement>(".lxe-chip")[selection.token];
    chip?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selection.line, selection.token]);

  function exportAs(kind: "json" | "lrc") {
    const name = (asset.title || asset.file.name).replace(/\.[^.]+$/, "");
    const text = kind === "json" ? toJson(docRef.current) : toLrc(docRef.current);
    const blob = new Blob([text], { type: kind === "json" ? "application/json" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${name}.${kind}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function onImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void file.text().then((text) => {
      const next = parseLyrics(text);
      setPending({
        message: `Replace the current lyrics with “${file.name}” (${next.lines.length} lines)?`,
        confirm: "Replace",
        run: () => {
          apply(next);
          select(0, -1);
        },
      });
    });
  }

  function requestClose() {
    if (!dirty) { onClose(); return; }
    setPending({ message: "This document has unsaved changes.", confirm: "Discard changes", run: onClose });
  }

  function addFirstLine() {
    apply(addLine(docRef.current, docRef.current.lines.length, ""));
    select(docRef.current.lines.length, -1);
  }

  /** The paste step's Continue: read whatever was pasted (LRC and JSON keep their times), split
      by newline and cut every line into words — all of it one undo entry. */
  function useIntro() {
    setIntro(false);
    const parsed = parseLyrics(introText);
    apply(tokenizeAllLines(parsed));
    select(0, -1);
  }

  return (
    <section className="lxe" aria-label="Edit lyrics">
      <header className="lxe-head">
        <button className="ghost-button" data-glass-edge="" onClick={requestClose}><ArrowLeft size={15} /> Back</button>
        <div className="lxe-title"><h1>Edit lyrics</h1><p>{asset.title || asset.file.name}</p></div>
        <div className="lxe-actions">
          <button className="icon-button" data-glass-edge="" onClick={undo} disabled={historyRef.current.past.length === 0} aria-label="Undo" title="Undo (Cmd/Ctrl+Z)"><Undo2 size={16} /></button>
          <button className="icon-button" data-glass-edge="" onClick={redo} disabled={historyRef.current.future.length === 0} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)"><Redo2 size={16} /></button>
          <button className="toolbar-button" onClick={() => importRef.current?.click()}><FileUp size={14} /> Import</button>
          <button className="toolbar-button" onClick={() => exportAs("json")} title="Export the full document, translations and tokens included"><Download size={14} /> Export JSON</button>
          <button className="toolbar-button" onClick={() => exportAs("lrc")} title="Export timed lines as LRC"><Download size={14} /> Export LRC</button>
          <button className="primary-button" onClick={save} disabled={!asset.apiId || saving === "saving"}>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved ✓" : dirty ? "Save" : "Saved"}</button>
        </div>
      </header>
      {!asset.apiId && <p className="lxe-note">This song is not in the library yet — you can export the lyrics and import them once it is uploaded.</p>}
      {error && <p className="error-message">{error}</p>}
      <div className="lxe-body">
        <div className="lxe-editor">
          <div className="lxe-rows" ref={rowsRef}>
            {doc.lines.map((line, index) => (
              <EditorRow key={index} doc={doc} index={index} duration={duration} selected={selection.line === index}
                selectedToken={selection.line === index ? selection.token : -1}
                range={range && range.line === index ? { from: range.from, to: range.to } : null}
                playingRange={playingRange}
                onSelect={select} onApply={apply}
                onRange={(lineIndex, next) => setRange(next ? { line: lineIndex, from: next.from, to: next.to } : null)}
                onMerge={mergeRange} onPlayRange={playRange} playhead={playhead} />
            ))}
            {doc.lines.length === 0 && <p className="lxe-empty">Nothing here yet — import a file above, or add the first line.</p>}
            <button className="ghost-button lxe-add-line" onClick={addFirstLine}><Plus size={14} /> Add line</button>
          </div>
        </div>
        <aside className="lxe-side">
          <div className="lxe-transport" data-glass-edge="">
            <div className="lxe-transport-row">
              <button className="primary-button" onClick={onTogglePlayback} aria-label={playing ? "Pause" : "Play"}>{playing ? <PauseGlyph size={18} /> : <PlayGlyph size={18} />}<span>{playing ? "Pause" : "Play"}</span></button>
              <TimeReadout media={media} />
            </div>
            <SeekBar media={media} ariaLabel="Seek" onSeek={cancelInterval} />
            <RangeControl label="Speed" value={speed} min={0.3} max={2} step={0.05} display={`${speed.toFixed(2)}×`} onChange={setSpeed} />
            <div className="lxe-offset">
              <label>Offset<input type="number" data-glass-edge="" step="10" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value) || 0)} />ms</label>
              <button className="toolbar-button" disabled={!doc.lines.some((line) => typeof line.start === "number")} onClick={() => {
                const next = shiftAll(docRef.current, offsetMs / 1000);
                if (next) { apply(next); setOffsetMs(0); setError(""); }
                else setError("That offset would push times below zero.");
              }}>Apply to all</button>
            </div>
          </div>
          <div className="lxe-preview">
            <p className="eyebrow">Live preview — the playback page, exactly</p>
            <div className="lxe-preview-stage"><PlaybackLyrics doc={doc} media={media} variant="preview" /></div>
          </div>
          <p className="lxe-keys">Space play · Enter stamp · drag words + Enter merge · ← → nudge · ↑ ↓ word · ⌘Z undo</p>
        </aside>
      </div>
      <input ref={importRef} type="file" accept=".lrc,.txt,.json,text/plain,application/json" hidden onChange={onImportFile} />
      {intro && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setIntro(false); }}>
          <div className="auth-modal" data-glass-edge="" role="dialog" aria-modal="true">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Before timing</p>
                <h2>Paste the full lyrics</h2>
                <p>One line per sentence — every line is cut into words automatically, timing comes next. LRC and JSON keep their own times.</p>
              </div>
            </div>
            <textarea className="lxe-intro-text" data-glass-edge="" value={introText} autoFocus
              placeholder={"First line of the song\nSecond line\n…"} onChange={(event) => setIntroText(event.target.value)} />
            <div className="lxe-confirm-actions">
              <button className="ghost-button" data-glass-edge="" onClick={() => setIntro(false)}>Skip</button>
              <button className="primary-button" disabled={!introText.trim()} onClick={useIntro}>Use lyrics</button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPending(null); }}>
          <div className="auth-modal" data-glass-edge="" role="dialog" aria-modal="true">
            <p>{pending.message}</p>
            <div className="lxe-confirm-actions">
              <button className="ghost-button" data-glass-edge="" onClick={() => setPending(null)}>Cancel</button>
              <button className="primary-button" onClick={() => { const run = pending.run; setPending(null); run(); }}>{pending.confirm}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
