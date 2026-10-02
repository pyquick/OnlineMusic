"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { ArrowLeft, Download, FileUp, Plus, Redo2, Undo2 } from "lucide-react";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import { RangeControl } from "@/design-system/components/RangeControl";
import { ApiError } from "@/infrastructure/api/client";
import {
  addLine, moveLine, moveToken, parseLyrics, setLineSpan, setTokenSpan, shiftAll, toJson, toLrc, tokenizeLineAt, type LyricsDoc,
} from "@/shared/lyrics";
import type { Asset } from "@/shared/types/media";
import { saveLyricsDoc } from "./client";
import PlaybackLyrics from "./PlaybackLyrics";
import EditorRow from "./EditorRow";
import { stampText } from "./format";
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

/** The transport's clock, read straight from the element — no React state per frame. */
function TimeReadout({ media }: { media: RefObject<HTMLMediaElement | null> }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const found = media.current;
    if (!found) return;
    const audio = found;
    let frame = 0;
    const place = () => {
      if (ref.current) {
        const total = Number.isFinite(audio.duration) ? audio.duration : 0;
        ref.current.textContent = `${stampText(audio.currentTime)} / ${stampText(total)}`;
      }
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
  return <span className="lxe-clock" ref={ref} />;
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
  const select = useCallback((line: number, token: number) => setSelection({ line, token }), []);

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

  /** Enter: stamp the boundary under the playhead, or lay down a line's span first. */
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
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
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
      if (typing) return;
      if (event.key === " " || event.code === "Space") { event.preventDefault(); onTogglePlayback(); return; }
      if (event.key === "Enter") { event.preventDefault(); stamp(); return; }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        const step = event.altKey ? 0.001 : event.shiftKey ? 0.1 : 0.01;
        event.preventDefault();
        nudge(direction * step);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        stepToken(event.key === "ArrowUp" ? -1 : 1);
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); requestClose(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, nudge, stepToken, undo, redo, onTogglePlayback, onClose, dirty]);

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

  return (
    <section className="lxe" aria-label="Edit lyrics">
      <header className="lxe-head">
        <button className="ghost-button" onClick={requestClose}><ArrowLeft size={15} /> Back</button>
        <div className="lxe-title"><h1>Edit lyrics</h1><p>{asset.title || asset.file.name}</p></div>
        <div className="lxe-actions">
          <button className="icon-button" onClick={undo} disabled={historyRef.current.past.length === 0} aria-label="Undo" title="Undo (Cmd/Ctrl+Z)"><Undo2 size={16} /></button>
          <button className="icon-button" onClick={redo} disabled={historyRef.current.future.length === 0} aria-label="Redo" title="Redo (Cmd/Ctrl+Shift+Z)"><Redo2 size={16} /></button>
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
                onSelect={select} onApply={apply} playhead={playhead} />
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
            <RangeControl label="Speed" value={speed} min={0.3} max={2} step={0.05} display={`${speed.toFixed(2)}×`} onChange={setSpeed} />
            <div className="lxe-offset">
              <label>Offset<input type="number" step="10" value={offsetMs} onChange={(event) => setOffsetMs(Number(event.target.value) || 0)} />ms</label>
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
          <p className="lxe-keys">Space play · Enter stamp · ← → nudge · ↑ ↓ word · ⌘Z undo</p>
        </aside>
      </div>
      <input ref={importRef} type="file" accept=".lrc,.txt,.json,text/plain,application/json" hidden onChange={onImportFile} />
      {pending && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPending(null); }}>
          <div className="auth-modal" data-glass-edge="" role="dialog" aria-modal="true">
            <p>{pending.message}</p>
            <div className="lxe-confirm-actions">
              <button className="ghost-button" onClick={() => setPending(null)}>Cancel</button>
              <button className="primary-button" onClick={() => { const run = pending.run; setPending(null); run(); }}>{pending.confirm}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
