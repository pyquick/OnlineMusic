"use client";

import { useMemo, type RefObject } from "react";
import { hasTiming, hasWordTiming, tokenOffsets, type LyricsDoc, type LyricsLine, type LyricsToken } from "@/shared/lyrics";
import { useLyricsSync } from "./useLyricsSync";
import "./lyrics.css";

/**
 * The one lyrics renderer: the desk's sheet, the phone's artwork slot and the editor's preview are
 * all this component with a different box around it, so what the user hears in the player is what
 * the editor shows while they time it. The words are fixed at 24px/700 in every layout — the
 * hierarchy is carried by brightness (played lines keep their finished look, unplayed lines sit
 * dimmer, the live line is white) and by the per-token fill of the line being sung.
 */
export type PlaybackLyricsProps = {
  doc: LyricsDoc | null;
  media: RefObject<HTMLMediaElement | null>;
  /** `words` is the phone's variant: the window sizes itself to three blocks. */
  variant?: "sheet" | "words" | "preview";
  className?: string;
};

type Segment = { text: string; token: LyricsToken | null };

/**
 * The line's text split into token spans and the gaps between them, rebuilt from the token texts'
 * own offsets so the words are rendered exactly as written — spacing and punctuation included —
 * and each token still has its own span for the fill.
 */
function segmentsOf(line: LyricsLine, tokens: LyricsToken[]): Segment[] {
  const offsets = tokenOffsets(line.text, tokens);
  if (!offsets.length) return [{ text: line.text, token: null }];
  const parts: Segment[] = [];
  let cursor = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    if (offsets[index] > cursor) parts.push({ text: line.text.slice(cursor, offsets[index]), token: null });
    parts.push({ text: tokens[index].text, token: tokens[index] });
    cursor = offsets[index] + tokens[index].text.length;
  }
  if (cursor < line.text.length) parts.push({ text: line.text.slice(cursor), token: null });
  return parts;
}

export default function PlaybackLyrics({ doc, media, variant = "sheet", className = "" }: PlaybackLyricsProps) {
  const timed = useMemo(() => (doc && hasTiming(doc) ? doc : null), [doc]);
  const { containerRef, activeLine, active } = useLyricsSync(media, timed);
  const lines = doc?.lines ?? [];

  return (
    <div ref={containerRef} className={`lyr lyr--${variant} ${className}`.trim()}>
      <div className="lyr-rail">
        {lines.map((line, index) => {
          // Without timing every line is a finished one — the plain-text import reads as written.
          const state = !timed ? "past" : index < activeLine ? "past" : index === activeLine ? (active ? "active" : "past") : "future";
          return (
            <p className={`lyr-line is-${state}`} key={index} data-lyr-line={index}>
              <span className="lyr-orig">
                {/* A line without word timing still fills — whole-line, off its own span — so the
                    one span carries the token marker either way; untimed tokens read as a line. */}
                {hasWordTiming(line) && line.tokens ? segmentsOf(line, line.tokens).map((segment, segmentIndex) => segment.token ? (
                  <span className="lyr-token" data-lyr-token key={segmentIndex}>{segment.text}</span>
                ) : (
                  <span className="lyr-gap" key={segmentIndex}>{segment.text}</span>
                )) : (
                  <span className="lyr-token" data-lyr-token>{line.text}</span>
                )}
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
