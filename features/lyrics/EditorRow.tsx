"use client";

import { useState, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { PauseGlyph, PlayGlyph } from "@/design-system/components/TransportGlyphs";
import { mergeLines, setLineSpan, setLineTranslation, setLineText, setTokenSpan, setTokenText, deleteToken, moveLine, splitLine, tokenizeLineAt, addLine, deleteLine, type LyricsDoc, type LyricsLine } from "@/shared/lyrics";
import { parseStamp, stampText } from "./format";

/**
 * One lyric line's row: the sentence, its words, its translation, its span on the ruler. The row
 * is the unit of work in the editor — selection travels by row — and every change goes up through
 * `onApply` as a whole new document, which is what the undo stack records.
 *
 * The hierarchy is the point: a sentence carries the translation (never a word), and its words —
 * the subsets the karaoke fill runs through — are gathered in their own labelled group below it,
 * each with its own start and end, so time is adjusted in words. A word without times yet is a
 * chip like any other; it simply has no time to show and no interval to play.
 *
 * Two gestures live on the words: dragging across adjacent chips selects them (Enter merges, and a
 * touch release merges at once), and each chip's own play button auditions just that word.
 */
export type EditorRowProps = {
  doc: LyricsDoc;
  index: number;
  duration: number;
  selected: boolean;
  selectedToken: number;
  /** The drag-selected token range on this line, if any — what Enter merges. */
  range: { from: number; to: number } | null;
  /** The interval currently auditioning, so the right play button shows Pause. */
  playingRange: { start: number; end: number } | null;
  onSelect: (line: number, token: number) => void;
  onApply: (next: LyricsDoc | null, coalesce?: string) => void;
  onRange: (line: number, range: { from: number; to: number } | null) => void;
  onMerge: (line: number, from: number, to: number) => void;
  onPlayRange: (start: number, end: number) => void;
  playhead: () => number;
};

/**
 * A time field: shows `m:ss.mmm`, reads the same back (bare seconds included — see `parseStamp`),
 * and keeps the draft while typing. Blur commits. Enter commits too, but stays in the field and
 * prints what was understood, so the editor's own stamp key — which rewrites the selected word's
 * end at the playhead — is never what a second Enter press lands on.
 */
function TimeInput({ value, title, onChange }: { value: number | undefined; title: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(value === undefined ? "" : stampText(value));
  const [focused, setFocused] = useState(false);
  // The edit belongs to the word the field was opened on: clicking another chip changes the
  // selection first and only then blurs this input, and a commit that read the current props
  // would write the number into that *other* word — which is exactly how an end typed here used
  // to land on the next word's own end.
  const commitTo = useRef(onChange);
  const shown = focused ? draft : value === undefined ? "" : stampText(value);
  return (
    <input className="lxe-time-input" data-glass-edge="" data-transport-space="" inputMode="decimal" value={shown} title={title} placeholder="–"
      onFocus={() => { commitTo.current = onChange; setDraft(value === undefined ? "" : stampText(value)); setFocused(true); }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const parsed = parseStamp(draft);
        if (parsed !== null) commitTo.current(parsed);
        setFocused(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        // The key is consumed here: it must not travel on to the editor's Enter, which stamps the
        // selected word's end at the playhead — the "the end changed by itself" the fields had.
        event.preventDefault();
        event.stopPropagation();
        const parsed = parseStamp(draft);
        if (parsed !== null) { setDraft(stampText(parsed)); commitTo.current(parsed); }
        else if (value !== undefined) setDraft(stampText(value));
        setFocused(true);
      }} />
  );
}

export default function EditorRow({ doc, index, duration, selected, selectedToken, range, playingRange, onSelect, onApply, onRange, onMerge, onPlayRange, playhead }: EditorRowProps) {
  const line: LyricsLine | undefined = doc.lines[index];
  const spanRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "start" | "end"; clientX: number; start: number; end: number; width: number } | null>(null);
  const dragRange = useRef<{ from: number; to: number; moved: boolean; reportedFrom: number; reportedTo: number } | null>(null);
  /** A drag that selected a range must not let the click that follows re-select a single chip. */
  const suppressClick = useRef(false);
  if (!line) return null;

  const timed = typeof line.start === "number" && typeof line.end === "number" && duration > 0;
  const tokens = line.tokens ?? [];
  const selectedTokenEntry = selectedToken >= 0 ? tokens[selectedToken] : undefined;
  const sentenceStart = typeof line.start === "number" ? line.start : undefined;
  const sentenceEnd = typeof line.end === "number" ? line.end : undefined;
  const sentencePlayable = sentenceStart !== undefined && sentenceEnd !== undefined && sentenceEnd > sentenceStart;
  const sentencePlaying = playingRange !== null && playingRange.start === sentenceStart && playingRange.end === sentenceEnd;

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
        const start = tokens[i].start;
        if (typeof start !== "number") continue;
        if (start <= t) best = i;
        else break;
      }
      at = best;
    }
    if (at <= 0 || at >= tokens.length) return;
    onApply(splitLine(doc, index, at));
    onSelect(index + 1, -1);
  }

  /**
   * Dragging across the word chips selects the range between them. Pointer capture keeps the
   * moves coming to this container, so the chip under the pointer is found by hit-testing; a
   * touch release merges the range at once, a mouse release leaves it for Enter.
   */
  function beginRange(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".lxe-chip-play")) return;
    const chip = (event.target as HTMLElement).closest<HTMLElement>("[data-lxe-token]");
    if (!chip) return;
    const at = Number(chip.dataset.lxeToken);
    // The word is picked on the way down rather than on the click: this container captures the
    // pointer for the range gesture, and a captured pointer makes the browser hand the following
    // click to the capturing element — so a plain click on a chip never reached the chip's own
    // handler, and selecting a single word did nothing. Selecting here also gives a finger its
    // feedback at the moment it touches the word.
    suppressClick.current = false;
    onSelect(index, at);
    if (tokens.length < 2) return;
    dragRange.current = { from: at, to: at, moved: false, reportedFrom: -1, reportedTo: -1 };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* pointer is already gone */ }
  }

  function moveRange(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRange.current;
    if (!state) return;
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-lxe-token]");
    if (!over) return;
    const to = Number(over.dataset.lxeToken);
    state.to = to;
    state.moved = to !== state.from;
    // Report only real changes: a pointermove fires tens of times a second, and every report
    // re-renders the whole list.
    const from = Math.min(state.from, to);
    const high = Math.max(state.from, to);
    if (!state.moved) {
      if (state.reportedTo >= 0) { state.reportedFrom = state.reportedTo = -1; onRange(index, null); }
      return;
    }
    if (state.reportedFrom === from && state.reportedTo === high) return;
    state.reportedFrom = from;
    state.reportedTo = high;
    onRange(index, { from, to: high });
  }

  function endRange(event: ReactPointerEvent<HTMLDivElement>) {
    const state = dragRange.current;
    dragRange.current = null;
    if (!state || !state.moved) { onRange(index, null); return; }
    suppressClick.current = true;
    // A finger has no Enter key: letting go of the drag is the merge.
    if (event.pointerType !== "mouse") onMerge(index, Math.min(state.from, state.to), Math.max(state.from, state.to));
  }

  return (
    <article className={`lxe-row ${selected ? "is-selected" : ""}`} data-glass-edge="" data-lxe-row={index}
      onPointerDown={(event) => { if ((event.target as HTMLElement).closest("[data-lxe-token]")) return; onSelect(index, selectedToken); }}>
      <header className="lxe-row-head">
        <span className="lxe-index">{index + 1}</span>
        <TimeInput value={line.start} title="Line start — m:ss.mmm, or seconds" onChange={(value) => onApply(setLineSpan(doc, index, { start: value }))} />
        <span className="lxe-arrow">→</span>
        <TimeInput value={line.end} title="Line end — m:ss.mmm, or seconds" onChange={(value) => onApply(setLineSpan(doc, index, { end: value }))} />
        {/* Icon only, between the sentence's times and its words: auditions just this span. */}
        <button type="button" className="icon-button" data-glass-edge="" disabled={!sentencePlayable}
          onClick={() => onPlayRange(sentenceStart as number, sentenceEnd as number)}
          aria-label={sentencePlaying ? "Pause this sentence" : "Play this sentence"} title="Play just this sentence">
          {sentencePlaying ? <PauseGlyph size={15} /> : <PlayGlyph size={15} />}
        </button>
        <div className="lxe-row-tools">
          <button type="button" className="small-action" title="Split this line into words (timing not needed)" disabled={!line.text.trim()} onClick={() => { onApply(tokenizeLineAt(doc, index)); onSelect(index, 0); }}>Tokenize</button>
          <button type="button" className="small-action" title="Split at the selected token (or the playhead)" disabled={tokens.length < 2} onClick={splitHere}>Split</button>
          <button type="button" className="small-action" title="Merge with the next line" disabled={index >= doc.lines.length - 1} onClick={() => { onApply(mergeLines(doc, index)); onSelect(index, -1); }}>Merge</button>
          <button type="button" className="small-action" title="Add a line below" onClick={() => { onApply(addLine(doc, index + 1, "")); onSelect(index + 1, -1); }}>Add line</button>
          <button type="button" className="small-action is-danger" title="Delete this line" onClick={() => { onApply(deleteLine(doc, index)); onSelect(Math.max(0, index - 1), -1); }}>Delete</button>
        </div>
      </header>
      <div className="lxe-fields">
        <label>Original
          <input data-glass-edge="" value={line.text} placeholder="Type the line" onChange={(event) => onApply(setLineText(doc, index, event.target.value), `text:${index}`)} />
        </label>
        <label>Translation
          <input data-glass-edge="" value={line.translation ?? ""} placeholder="Add a translation" onChange={(event) => onApply(setLineTranslation(doc, index, event.target.value || undefined), `trans:${index}`)} />
        </label>
      </div>
      <div className={`lxe-track ${timed ? "" : "is-untimed"}`}
        onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        {timed && <div className="lxe-span" ref={spanRef} style={{ left: `${((line.start as number) / duration) * 100}%`, width: `${(((line.end as number) - (line.start as number)) / duration) * 100}%` }} />}
        <div className="lxe-tip" ref={tipRef} />
        {!timed && <span className="lxe-track-hint">Not timed yet — park the playhead and press Enter</span>}
      </div>
      <div className="lxe-words">
        <p className="eyebrow">Words{tokens.length > 0 ? ` · ${tokens.length}` : ""}</p>
        {tokens.length > 0 && (
          <div className="lxe-tokens" onPointerDown={beginRange} onPointerMove={moveRange} onPointerUp={endRange} onPointerCancel={() => { dragRange.current = null; }}>
            {tokens.map((token, tokenIndex) => {
              const inRange = range !== null && tokenIndex >= range.from && tokenIndex <= range.to;
              const tokenPlayable = typeof token.start === "number" && typeof token.end === "number" && token.end > token.start;
              const tokenPlaying = playingRange !== null && playingRange.start === token.start && playingRange.end === token.end;
              return (
                <span className="lxe-token" key={tokenIndex} data-lxe-token={tokenIndex}>
                  <button type="button" className={`lxe-chip ${selected && selectedToken === tokenIndex ? "is-selected" : ""} ${inRange ? "is-in-range" : ""}`} data-glass-edge=""
                    onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } onSelect(index, tokenIndex); }}
                    title={tokenPlayable ? `${token.text} · ${stampText(token.start)} → ${stampText(token.end)}` : token.text}>
                    <b>{token.text || "·"}</b>
                    {/* A word being timed shows its open edge at once: "15.000→–" until closed. */}
                    {(typeof token.start === "number" || typeof token.end === "number") && (
                      <small>{typeof token.start === "number" ? stampText(token.start) : "–"}→{typeof token.end === "number" ? stampText(token.end) : "–"}</small>
                    )}
                  </button>
                  <button type="button" className="lxe-chip lxe-chip-play" data-glass-edge="" disabled={!tokenPlayable}
                    onClick={() => onPlayRange(token.start as number, token.end as number)}
                    aria-label={tokenPlaying ? `Pause ${token.text}` : `Play ${token.text}`} title="Play just this word">
                    {tokenPlaying ? <PauseGlyph size={12} /> : <PlayGlyph size={12} />}
                  </button>
                </span>
              );
            })}
          </div>
        )}
        {tokens.length === 0 && <p className="lxe-words-hint">No words yet — Tokenize splits this sentence into them.</p>}
        {selectedTokenEntry && (
          <div className="lxe-token-edit">
            <span className="lxe-token-edit-label">Word <b>{selectedTokenEntry.text || "·"}</b></span>
            <input className="lxe-token-text" data-glass-edge="" value={selectedTokenEntry.text} aria-label="Word text"
              onChange={(event) => onApply(setTokenText(doc, index, selectedToken, event.target.value), `tokentext:${index}:${selectedToken}`)} />
            <TimeInput value={selectedTokenEntry.start} title="Word start — m:ss.mmm, or seconds" onChange={(value) => onApply(setTokenSpan(doc, index, selectedToken, { start: value }))} />
            <TimeInput value={selectedTokenEntry.end} title="Word end — m:ss.mmm, or seconds" onChange={(value) => onApply(setTokenSpan(doc, index, selectedToken, { end: value }))} />
            <button type="button" className="small-action" disabled={typeof selectedTokenEntry.start !== "number"}
              onClick={() => onApply(setTokenSpan(doc, index, selectedToken, { end: playhead() }))} title="Stamp this word's end at the playhead">Stamp end</button>
            <button type="button" className="small-action is-danger" onClick={() => { onApply(deleteToken(doc, index, selectedToken)); onSelect(index, -1); }}>Delete word</button>
          </div>
        )}
      </div>
    </article>
  );
}
