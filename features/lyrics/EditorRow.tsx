"use client";

import { useState, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { mergeLines, setLineSpan, setLineTranslation, setLineText, setTokenSpan, setTokenText, deleteToken, moveLine, splitLine, tokenizeLineAt, addLine, deleteLine, type LyricsDoc, type LyricsLine } from "@/shared/lyrics";
import { stampText } from "./format";

/**
 * One lyric line's row: the sentence, its words, its translation, its span on the ruler. The row
 * is the unit of work in the editor — selection travels by row — and every change goes up through
 * `onApply` as a whole new document, which is what the undo stack records.
 *
 * The hierarchy is the point: a sentence carries the translation (never a word), and its words —
 * the subsets the karaoke fill runs through — are gathered in their own labelled group below it,
 * each with its own start and end, so time is adjusted in words.
 */
export type EditorRowProps = {
  doc: LyricsDoc;
  index: number;
  duration: number;
  selected: boolean;
  selectedToken: number;
  onSelect: (line: number, token: number) => void;
  onApply: (next: LyricsDoc | null, coalesce?: string) => void;
  playhead: () => number;
};

/** A number input that keeps a draft while typing and commits on blur or Enter. */
function TimeInput({ value, title, onChange }: { value: number | undefined; title: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : value.toFixed(3));
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value === undefined ? "" : value.toFixed(3);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed)) onChange(Math.max(0, parsed));
    setFocused(false);
  };
  return (
    <input className="lxe-time-input" inputMode="decimal" value={shown} title={title} placeholder="–"
      onFocus={() => { setDraft(value === undefined ? "" : value.toFixed(3)); setFocused(true); }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { commit(); (event.target as HTMLInputElement).blur(); } }} />
  );
}

export default function EditorRow({ doc, index, duration, selected, selectedToken, onSelect, onApply, playhead }: EditorRowProps) {
  const line: LyricsLine | undefined = doc.lines[index];
  const spanRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "start" | "end"; clientX: number; start: number; end: number; width: number } | null>(null);
  if (!line) return null;

  const timed = typeof line.start === "number" && typeof line.end === "number" && duration > 0;
  const tokens = line.tokens ?? [];
  const selectedTokenEntry = selectedToken >= 0 ? tokens[selectedToken] : undefined;

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!timed || !line) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - rect.left) / rect.width) * duration;
    const edge = (9 / rect.width) * duration;
    const mode = Math.abs(at - (line.start as number)) <= edge
      ? "start"
      : Math.abs(at - (line.end as number)) <= edge
        ? "end"
        : "move";
    drag.current = { mode, clientX: event.clientX, start: line.start as number, end: line.end as number, width: rect.width };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer is already gone */ }
    onSelect(index, -1);
  }

  function dragTimes(clientX: number) {
    const state = drag.current;
    if (!state) return null;
    const raw = ((clientX - state.clientX) / state.width) * duration;
    const delta = Math.round(raw * 100) / 100;                 // snap to the 10 ms the keys use
    if (state.mode === "move") {
      const shift = Math.min(Math.max(delta, -state.start), Math.max(0, duration - state.end));
      return { start: state.start + shift, end: state.end + shift };
    }
    if (state.mode === "start") {
      const start = Math.min(Math.max(0, state.start + delta), state.end - 0.05);
      return { start, end: state.end };
    }
    const end = Math.max(Math.min(duration, state.end + delta), state.start + 0.05);
    return { start: state.start, end };
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const next = dragTimes(event.clientX);
    if (!next) return;
    const span = spanRef.current;
    if (span && duration > 0) {
      span.style.left = `${(next.start / duration) * 100}%`;
      span.style.width = `${((next.end - next.start) / duration) * 100}%`;
    }
    const tip = tipRef.current;
    if (tip) {
      tip.style.left = `${(event.clientX - event.currentTarget.getBoundingClientRect().left)}px`;
      tip.textContent = `${stampText(next.start)} → ${stampText(next.end)}`;
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    drag.current = null;
    const next = state && dragTimes(event.clientX);
    const tip = tipRef.current;
    if (tip) tip.textContent = "";
    if (!next || !state) return;
    if (state.mode === "move") onApply(moveLine(doc, index, next.start - state.start));
    else onApply(setLineSpan(doc, index, next));
  }

  /** Split where the user is looking: the selected token, else the token nearest the playhead. */
  function splitHere() {
    let at = selectedToken;
    if (at <= 0 || at >= tokens.length) {
      const t = playhead();
      let best = -1;
      for (let i = 1; i < tokens.length; i += 1) {
        if (tokens[i].start <= t) best = i;
        else break;
      }
      at = best;
    }
    if (at <= 0 || at >= tokens.length) return;
    onApply(splitLine(doc, index, at));
    onSelect(index + 1, -1);
  }

  return (
    <article className={`lxe-row ${selected ? "is-selected" : ""}`} data-lxe-row={index} onPointerDown={() => onSelect(index, selectedToken)}>
      <header className="lxe-row-head">
        <span className="lxe-index">{index + 1}</span>
        <TimeInput value={line.start} title="Line start (seconds)" onChange={(value) => onApply(setLineSpan(doc, index, { start: value }))} />
        <span className="lxe-arrow">→</span>
        <TimeInput value={line.end} title="Line end (seconds)" onChange={(value) => onApply(setLineSpan(doc, index, { end: value }))} />
        <div className="lxe-row-tools">
          <button type="button" className="small-action" title="Tokenize this line" disabled={!timed || !line.text.trim()} onClick={() => { onApply(tokenizeLineAt(doc, index)); onSelect(index, 0); }}>Tokenize</button>
          <button type="button" className="small-action" title="Split at the selected token (or the playhead)" disabled={tokens.length < 2} onClick={splitHere}>Split</button>
          <button type="button" className="small-action" title="Merge with the next line" disabled={index >= doc.lines.length - 1} onClick={() => { onApply(mergeLines(doc, index)); onSelect(index, -1); }}>Merge</button>
          <button type="button" className="small-action" title="Add a line below" onClick={() => { onApply(addLine(doc, index + 1, "")); onSelect(index + 1, -1); }}>Add line</button>
          <button type="button" className="small-action is-danger" title="Delete this line" onClick={() => { onApply(deleteLine(doc, index)); onSelect(Math.max(0, index - 1), -1); }}>Delete</button>
        </div>
      </header>
      <div className="lxe-fields">
        <label>Original
          <input value={line.text} placeholder="Type the line" onChange={(event) => onApply(setLineText(doc, index, event.target.value), `text:${index}`)} />
        </label>
        <label>Translation
          <input value={line.translation ?? ""} placeholder="Add a translation" onChange={(event) => onApply(setLineTranslation(doc, index, event.target.value || undefined), `trans:${index}`)} />
        </label>
      </div>
      <div className={`lxe-track ${timed ? "" : "is-untimed"}`}
        onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {timed && <div className="lxe-span" ref={spanRef} style={{ left: `${((line.start as number) / duration) * 100}%`, width: `${(((line.end as number) - (line.start as number)) / duration) * 100}%` }} />}
        <div className="lxe-tip" ref={tipRef} />
        {!timed && <span className="lxe-track-hint">Not timed yet — park the playhead and press Enter</span>}
      </div>
      <div className="lxe-words">
        <p className="lxe-words-label">Words{tokens.length > 0 ? ` · ${tokens.length}` : ""}</p>
        {tokens.length > 0 && (
          <div className="lxe-tokens">
            {tokens.map((token, tokenIndex) => (
              <button type="button" key={tokenIndex} className={`lxe-chip ${selected && selectedToken === tokenIndex ? "is-selected" : ""}`}
                onClick={() => onSelect(index, tokenIndex)} title={`${token.text} · ${stampText(token.start)} → ${stampText(token.end)}`}>
                <b>{token.text || "·"}</b><small>{stampText(token.start)}→{stampText(token.end)}</small>
              </button>
            ))}
          </div>
        )}
        {tokens.length === 0 && <p className="lxe-words-hint">{timed ? "No words yet — Tokenize splits this sentence into them." : "Time the sentence first, then Tokenize it into words."}</p>}
        {selectedTokenEntry && (
          <div className="lxe-token-edit">
            <input className="lxe-token-text" value={selectedTokenEntry.text} aria-label="Token text"
              onChange={(event) => onApply(setTokenText(doc, index, selectedToken, event.target.value), `tokentext:${index}:${selectedToken}`)} />
            <TimeInput value={selectedTokenEntry.start} title="Word start (seconds)" onChange={(value) => onApply(setTokenSpan(doc, index, selectedToken, { start: value }))} />
            <TimeInput value={selectedTokenEntry.end} title="Word end (seconds)" onChange={(value) => onApply(setTokenSpan(doc, index, selectedToken, { end: value }))} />
            <button type="button" className="small-action" onClick={() => onApply(setTokenSpan(doc, index, selectedToken, { end: playhead() }))} title="Stamp this word's end at the playhead">Stamp end</button>
            <button type="button" className="small-action is-danger" onClick={() => { onApply(deleteToken(doc, index, selectedToken)); onSelect(index, -1); }}>Delete word</button>
          </div>
        )}
      </div>
    </article>
  );
}
