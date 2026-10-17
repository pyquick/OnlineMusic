"use client";

import { useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from "react";
import { hasTiming, hasWordTiming, seekTime, tokenOffsets, type LyricsDoc, type LyricsLine, type LyricsToken } from "@/shared/lyrics";
import { stampText } from "./format";
import { useLyricsSync } from "./useLyricsSync";
import "./lyrics.css";

/**
 * The one lyrics renderer: the desk's sheet, the phone's artwork slot and the editor's preview are
 * all this component with a different box around it, so what the user hears in the player is what
 * the editor shows while they time it. The words are fixed at 24px/700 in every layout — the
 * hierarchy is carried by brightness (played lines keep their finished look, unplayed lines sit
 * dimmer, the live line is white) and by the per-token fill of the line being sung. Every line is
 * also handed its distance from the reading, which the stylesheet turns into the depth of the
 * column and the delay it answers with, and the live line lifts its words once the rail has
 * arrived — a word held longer than two seconds blooms (see lyrics.css, and HOLD_SECONDS in the
 * synchroniser).
 *
 * The words are also the document's own seek bar: a press on a word that has a time moves the
 * playhead to it, and a line timed without word times answers with its own start. Text with no
 * time set stays plain — the press only answers where the document has an answer.
 */
export type PlaybackLyricsProps = {
  doc: LyricsDoc | null;
  media: RefObject<HTMLMediaElement | null>;
  /** `words` is the phone's variant: the window sizes itself to three blocks. */
  variant?: "sheet" | "words" | "preview";
  className?: string;
};

/** `token` is the token's index in `line.tokens`, -1 for the line rendered as one span, null for
    the gaps between words — the gaps fill with the line, they are not words of their own. */
type Segment = { text: string; token: number | null };

/**
 * The line's text split into token spans and the gaps between them, rebuilt from the token texts'
 * own offsets so the words are rendered exactly as written — spacing and punctuation included —
 * and each token still has its own span for the fill, carrying the index a press hands back.
 */
function segmentsOf(line: LyricsLine, tokens: LyricsToken[]): Segment[] {
  const offsets = tokenOffsets(line.text, tokens);
  if (!offsets.length) return [{ text: line.text, token: null }];
  const parts: Segment[] = [];
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (offsets[index] > cursor) parts.push({ text: line.text.slice(cursor, offsets[index]), token: null });
    parts.push({ text: tokens[index].text, token: index });
    cursor = offsets[index] + tokens[index].text.length;
  }
  if (cursor < line.text.length) parts.push({ text: line.text.slice(cursor), token: null });
  return parts;
}

export default function PlaybackLyrics({ doc, media, variant = "sheet", className = "" }: PlaybackLyricsProps) {
  const timed = useMemo(() => (doc && hasTiming(doc) ? doc : null), [doc]);
  const { containerRef, activeLine, active } = useLyricsSync(media, timed);
  const lines = doc?.lines ?? [];

  /**
   * A press on the words moves the playhead: the word's own start when it has one, the line's
   * start when the line is the timed unit, and nothing where no time is set. A drag that ended in
   * a text selection is a copy, not a seek, so it is left alone.
   */
  function onSeek(event: ReactMouseEvent<HTMLDivElement>) {
    const element = media.current;
    const span = (event.target as HTMLElement).closest<HTMLElement>("[data-lyr-seek]");
    const lineElement = span?.closest<HTMLElement>("[data-lyr-line]");
    if (!timed || !element || !span || !lineElement) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const line = timed.lines[Number(lineElement.dataset.lyrLine)];
    if (!line) return;
    const raw = span.dataset.lyrToken;
    const at = seekTime(line, raw === undefined || raw === "" ? -1 : Number(raw));
    if (at !== null) element.currentTime = at;
  }

  return (
    <div ref={containerRef} className={`lyr lyr--${variant} ${className}`.trim()} onClick={onSeek}>
      <div className="lyr-rail">
        {lines.map((line, index) => {
          // Without timing every line is a finished one — the plain-text import reads as written.
          const state = !timed ? "past" : index < activeLine ? "past" : index === activeLine ? (active ? "active" : "past") : "future";
          // A line without word timing still fills — whole-line, off its own span — so `-1` marks
          // that one span as the line itself, which is also what a press on it seeks to.
          const parts: Segment[] = hasWordTiming(line) && line.tokens ? segmentsOf(line, line.tokens) : [{ text: line.text, token: -1 }];
          // How far ahead of the reading this line sits. The stylesheet turns the distance into the
          // depth of the column — fainter, softer and smaller the further out it is — and into the
          // delay each line answers with, so the change travels outwards from the focus. Lines
          // already sung are distance 0: they keep their finished look.
          const distance = activeLine < 0 ? index + 1 : Math.max(0, index - activeLine);
          return (
            <p className={`lyr-line is-${state}`} key={index} data-lyr-line={index} style={{ "--lyr-dist": distance } as CSSProperties}>
              <span className="lyr-orig">
                {parts.map((segment, segmentIndex) => {
                  if (segment.token === null) return <span className="lyr-gap" key={segmentIndex}>{segment.text}</span>;
                  const at = seekTime(line, segment.token);
                  return (
                    <span className="lyr-token" key={segmentIndex} data-lyr-token={segment.token < 0 ? "" : segment.token}
                      data-lyr-seek={timed && at !== null ? "" : undefined}
                      style={{ "--lyr-word-i": Math.max(0, segment.token) } as CSSProperties}
                      title={timed && at !== null ? `Jump to ${stampText(at)}` : undefined}>{segment.text}</span>
                  );
                })}
              </span>
              {line.translation ? <span className="lyr-trans">{line.translation}</span> : null}
            </p>
          );
        })}
        {lines.length === 0 && <p className="now-empty">No lyrics for this song yet.</p>}
      </div>
    </div>
  );
}
