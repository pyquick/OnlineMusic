/**
 * The studio's icon set, drawn here rather than taken from a package: one family in the shape
 * language of Apple's SF Symbols — a 24px frame, a light 1.8px stroke with round caps and joins,
 * flat-topped cogs, rounded speech bubbles, an optical disc with its little arc. The names are the
 * ones the app already called (lucide's, mostly) so a surface swaps the import, not its markup.
 *
 * It is a design-system primitive because every feature shows these glyphs: the pill and the rail,
 * the transport, the top bar, the editor toolbars, the now-playing window and the video overlay.
 * The play and pause are the transport's own filled glyphs (TransportGlyphs) — the same two the
 * bar, the dock and the disc have always shown — so the family has one transport language.
 *
 * Stroke width, caps and joins are defaults: a caller may still override any SVG prop. The two
 * skips are the exception to the outline family — they are solid triangles with a bar, the way a
 * transport's skips are cut (2026-10-03, the user's "改为实心的"): the Apple pair is the SF
 * Symbols *fill* variant, the drawn pair fills its triangle and keeps its stroke for the join.
 *
 * Where the studio's vocabulary overlaps Apple's, the glyph is now the real thing: house, music
 * note, albums, library, gear, lyrics bubble, pencil, shuffle, repeat, both skips, the speaker
 * and the waveform are inlined from the SF Symbols exports through `Glyph` below. Everything
 * else stays hand-drawn — those symbols have no export here.
 */
import { useLayoutEffect, useRef, useState, type MutableRefObject, type SVGProps } from "react";
import { PauseGlyph, PlayGlyph } from "./TransportGlyphs";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  const [ref, view] = useCentredView("0 0 24 24");
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={view}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * An SF Symbols export, inlined: a filled outline glyph on Apple's own frame, contained — never
 * stretched — in the caller's square size box, so it sits optically with the hand-drawn family.
 * The export's shapes *are* its strokes, so there is no stroke here, only the fill; a caller's
 * own props still override everything.
 */
function Glyph({ frame, size = 24, children, ...rest }: IconProps & { frame: string }) {
  const [ref, view] = useCentredView(frame);
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={view}
      fill="currentColor"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * The viewBox a glyph draws through: the frame it was authored in, squared, and then moved so the
 * shapes' own box is the viewBox's centre — measured once, before the first paint is shown.
 *
 * The artboard is not the glyph. The SF speech bubble's ink sits half a pixel below its frame's
 * centre, and the drawn list is a little left of its own; that is what reads as "the icon is off
 * centre" on a round tile, and no amount of centring the *box* can answer it. The scale is kept
 * (the squared frame's side), so a symbol keeps its drawn size and only its placement is corrected.
 */
function useCentredView(frame: string): [MutableRefObject<SVGSVGElement | null>, string] {
  const ref = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState(() => squareFrame(frame));
  useLayoutEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    try {
      const ink = svg.getBBox();
      if (ink && ink.width > 0 && ink.height > 0) setView(centredFrame(frame, ink));
    } catch {
      /* No layout yet (a hidden pane): the squared frame already centres the artboard. */
    }
  }, [frame]);
  return [ref, view];
}

/**
 * The export's frame, squared around its own centre.
 *
 * An SF export arrives on Apple's artboard, which is often a hair taller or wider than it is
 * square (the speech bubble is 27.87 by 27.28, the speaker 28.05 by 21.94). Fitting a non-square
 * viewBox into the square box the caller asks for is the engine's job through
 * `preserveAspectRatio`, and that is exactly where a glyph ends up a fraction off centre: the
 * fitted content is not on the pixel grid the tile is. Squaring the frame leaves the glyph where
 * the designer drew it — the added margin is split evenly — and makes the mapping a plain
 * scale, so what is centred by the layout is centred on the screen, in every engine.
 */
function squareFrame(frame: string): string {
  const [x, y, width, height] = frame.trim().split(/[\s,]+/).map(Number);
  if (![x, y, width, height].every(Number.isFinite)) return frame;
  const side = Math.max(width, height);
  return `${x - (side - width) / 2} ${y - (side - height) / 2} ${side} ${side}`;
}

/** The same frame again, moved so the ink's own centre is the viewBox's centre, at the same
    scale: the symbol keeps its drawn size and only its placement is corrected. */
function centredFrame(frame: string, ink: { x: number; y: number; width: number; height: number }): string {
  const [x, y, width, height] = frame.trim().split(/[\s,]+/).map(Number);
  if (![x, y, width, height].every(Number.isFinite)) return frame;
  const side = Math.max(width, height);
  const centreX = ink.x + ink.width / 2;
  const centreY = ink.y + ink.height / 2;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return `${round(centreX - side / 2)} ${round(centreY - side / 2)} ${side} ${side}`;
}

/**
 * Whether this device may show the SF Symbols. They are Apple-platform glyphs under Apple's
 * licence, so every component below renders its hand-drawn twin everywhere else. The first
 * render is always the hand-drawn one — the server has no platform to speak of — and a layout
 * effect swaps to the Apple glyphs before the browser paints, so no frame ever shows the wrong
 * set and hydration stays honest (a mismatch would have React throw the tree away).
 */
function useAppleGlyphs() {
  const [apple, setApple] = useState(false);
  useLayoutEffect(() => { setApple(onApplePlatform()); }, []);
  return apple;
}

function onApplePlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/* ── Navigation ─────────────────────────────────────────────────────────────── */

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleHouse(props: IconProps) {
  return (
    <Glyph frame="0 0 29.8242 26.2207" {...props}>
      <path d="M11.1 25.1 18.3 25.1 18.3 16.9 C18.3 16.4 18 16 17.5 16 L12 16 C11.5 16 11.1 16.4 11.1 16.9 ZM.9 13 C1.2 13 1.5 12.9 1.7 12.7 L14.3 2.1 C14.4 2 14.6 1.9 14.7 1.9 C14.9 1.9 15.1 2 15.2 2.1 L27.8 12.7 C28 12.9 28.2 13 28.5 13 C29.1 13 29.5 12.6 29.5 12.2 C29.5 11.9 29.4 11.7 29.1 11.4 L16.1 .6 C15.7 .2 15.2 0 14.7 0 C14.2 0 13.8 .2 13.3 .6 L.4 11.4 C.1 11.7 0 11.9 0 12.2 C0 12.6 .3 13 .9 13 ZM23.1 6.9 25.9 9.3 25.9 3.8 C25.9 3.3 25.6 3 25.1 3 L23.9 3 C23.4 3 23.1 3.3 23.1 3.8 ZM6.2 26.2 23.2 26.2 C25 26.2 25.9 25.2 25.9 23.5 L25.9 9.6 24.2 8.4 24.2 23.1 C24.2 24 23.8 24.5 22.9 24.5 L6.6 24.5 C5.7 24.5 5.3 24 5.3 23.1 L5.3 8.4 3.5 9.6 3.5 23.5 C3.5 25.2 4.5 26.2 6.2 26.2 Z" />
    </Glyph>
  );
}

export function House(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleHouse {...props} /> : (
    <Icon {...props}>
      <path d="M3.9 11.1 11 4.7a1.55 1.55 0 0 1 2 0l7.1 6.4" />
      <path d="M5.7 9.7V19a1.9 1.9 0 0 0 1.9 1.9h8.8a1.9 1.9 0 0 0 1.9-1.9V9.7" />
      <path d="M9.8 20.9v-4a2.2 2.2 0 0 1 4.4 0v4" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleMusic2(props: IconProps) {
  return (
    <Glyph frame="0 0 15.3711 25.5762" {...props}>
      <path d="M15 6.2 15 1.6 C15 .9 14.5 .5 13.9 .7 L7.6 2 C6.8 2.2 6.4 2.6 6.4 3.3 L6.5 17.1 C6.5 17.8 6.2 18.2 5.6 18.3 L3.6 18.8 C1.2 19.3 0 20.5 0 22.4 C0 24.3 1.4 25.6 3.5 25.6 C5.3 25.6 8 24.2 8 20.6 L8 9.2 C8 8.5 8.2 8.4 8.8 8.2 L14.4 7 C14.8 6.9 15 6.6 15 6.2 Z" />
    </Glyph>
  );
}

export function Music2(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleMusic2 {...props} /> : (
    <Icon {...props}>
      <ellipse cx="10.4" cy="16.7" rx="3.1" ry="2.5" transform="rotate(-25 10.4 16.7)" fill="currentColor" stroke="none" />
      <path d="M13.5 16.3V5.4" />
      <path d="M13.5 5.4c2.2-.6 4.3.3 4.3 2.1 0 1.5-1 2.7-2.6 3.5" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleDisc3(props: IconProps) {
  return (
    <Glyph frame="0 0 26.3379 32.8418" {...props}>
      <path d="M18.6 3.5 7.3 3.5 C7.4 2.6 8 2.1 8.9 2.1 L17.1 2.1 C18 2.1 18.6 2.6 18.6 3.5 Z" />
      <path d="M21.2 6.9 C20.8 6.9 20.4 6.9 20.1 6.9 L5.9 6.9 C5.5 6.9 5.2 6.9 4.8 6.9 C4.9 5.9 5.7 5.3 6.8 5.3 L19.2 5.3 C20.3 5.3 21 5.9 21.2 6.9 Z" />
      <path d="M5.9 30.7 20.1 30.7 C22.6 30.7 23.9 29.5 23.9 27 L23.9 12.7 C23.9 10.3 22.6 9 20.1 9 L5.9 9 C3.4 9 2.1 10.3 2.1 12.7 L2.1 27 C2.1 29.5 3.4 30.7 5.9 30.7 ZM5.9 29 C4.6 29 3.8 28.3 3.8 26.9 L3.8 12.8 C3.8 11.4 4.6 10.7 5.9 10.7 L20 10.7 C21.4 10.7 22.1 11.4 22.1 12.8 L22.1 26.9 C22.1 28.3 21.4 29 20 29 Z" />
    </Glyph>
  );
}

export function Disc3(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleDisc3 {...props} /> : (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M5.6 15.2a6.8 6.8 0 0 0 3.6 3.2" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleLibrary(props: IconProps) {
  return (
    <Glyph frame="0 0 30.3516 28.2715" {...props}>
      <path d="M0 25 C0 26.7 .8 27.6 2.6 27.6 L19.6 27.6 C21.4 27.6 22.2 26.7 22.2 25 L22.2 2.6 C22.2 .9 21.4 0 19.6 0 L17.1 0 C15.4 0 14.5 .9 14.5 2.6 L14.5 7.7 C14.2 7.7 13.9 7.6 13.5 7.6 L8 7.6 C7.6 7.6 7.3 7.7 7 7.7 L7 6 C7 4.2 6.2 3.3 4.4 3.3 L2.6 3.3 C.8 3.3 0 4.2 0 6 ZM1.6 24.8 1.6 6.1 C1.6 5.3 2 5 2.8 5 L4.3 5 C5 5 5.4 5.3 5.4 6.1 L5.4 26 2.8 26 C2 26 1.6 25.6 1.6 24.8 ZM7 26 7 10.4 C7 9.6 7.4 9.2 8.2 9.2 L13.4 9.2 C14.2 9.2 14.5 9.6 14.5 10.4 L14.5 26 ZM16.1 26 16.1 2.8 C16.1 2 16.5 1.6 17.3 1.6 L19.5 1.6 C20.3 1.6 20.6 2 20.6 2.8 L20.6 24.8 C20.6 25.6 20.3 26 19.5 26 ZM8.3 11.6 C8.3 12 8.5 12.3 8.9 12.3 L12.6 12.3 C13 12.3 13.3 12 13.3 11.6 C13.3 11.3 13 11 12.6 11 L8.9 11 C8.5 11 8.3 11.3 8.3 11.6 ZM8.3 23.6 C8.3 23.9 8.5 24.2 8.9 24.2 L12.6 24.2 C13 24.2 13.3 23.9 13.3 23.6 C13.3 23.2 13 22.9 12.6 22.9 L8.9 22.9 C8.5 22.9 8.3 23.2 8.3 23.6 ZM23.4 25.3 C23.6 27 24.5 27.8 26.3 27.6 L27.7 27.4 C29.4 27.2 30.2 26.3 30 24.5 L27.9 5.6 C27.7 3.9 26.8 3.1 25 3.3 L23.6 3.5 C21.8 3.7 21.1 4.7 21.3 6.4 ZM25 25 22.9 6.3 C22.9 5.6 23.2 5.2 24 5.1 L25 5 C25.8 4.9 26.2 5.2 26.3 5.9 L28.3 24.6 C28.4 25.4 28.1 25.7 27.3 25.8 L26.2 26 C25.5 26.1 25.1 25.7 25 25 Z" />
    </Glyph>
  );
}

export function Library(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleLibrary {...props} /> : (
    <Icon {...props}>
      <rect x="4.6" y="5.6" width="3.5" height="13.4" rx="1.3" />
      <rect x="10.25" y="4.4" width="3.5" height="14.6" rx="1.3" />
      <rect x="15.9" y="7.2" width="3.5" height="11.8" rx="1.3" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleSettings(props: IconProps) {
  return (
    <Glyph frame="0 0 29.0332 28.6426" {...props}>
      <path d="M14.3 28.6 C14.7 28.6 14.9 28.5 15 27.9 L15.1 26.9 C15.1 26.4 15.4 26.2 15.9 26.1 C16.4 26.1 16.7 26.3 16.9 26.7 L17.2 27.6 C17.5 28.1 17.7 28.2 18 28.2 C18.3 28.1 18.5 27.8 18.4 27.3 L18.3 26.3 C18.2 25.8 18.4 25.5 18.9 25.3 C19.3 25.1 19.7 25.2 20 25.6 L20.6 26.4 C20.9 26.9 21.2 26.9 21.5 26.7 C21.8 26.6 21.9 26.3 21.7 25.8 L21.3 24.8 C21.1 24.4 21.2 24.1 21.6 23.8 C22 23.5 22.3 23.4 22.7 23.7 L23.5 24.4 C24 24.7 24.3 24.7 24.5 24.5 C24.7 24.2 24.7 23.9 24.4 23.5 L23.8 22.7 C23.5 22.3 23.5 21.9 23.8 21.6 C24.1 21.2 24.4 21.1 24.9 21.3 L25.8 21.7 C26.3 21.9 26.6 21.8 26.7 21.5 C26.9 21.2 26.9 20.9 26.4 20.6 L25.6 20 C25.2 19.7 25.2 19.3 25.4 18.9 C25.5 18.4 25.8 18.2 26.3 18.3 L27.3 18.4 C27.9 18.5 28.1 18.3 28.2 18 C28.3 17.7 28.2 17.5 27.6 17.2 L26.7 16.9 C26.3 16.7 26.1 16.4 26.2 15.9 C26.2 15.4 26.4 15.1 26.9 15.1 L27.9 14.9 C28.5 14.9 28.7 14.6 28.7 14.3 C28.7 14 28.5 13.8 27.9 13.7 L26.9 13.6 C26.4 13.5 26.2 13.2 26.2 12.8 C26.1 12.3 26.3 12 26.7 11.8 L27.7 11.4 C28.2 11.2 28.3 10.9 28.2 10.6 C28.1 10.3 27.9 10.1 27.3 10.2 L26.3 10.4 C25.9 10.4 25.5 10.2 25.4 9.8 C25.2 9.3 25.2 9 25.6 8.7 L26.4 8.1 C26.9 7.7 26.9 7.4 26.8 7.2 C26.6 6.9 26.3 6.8 25.8 7 L24.9 7.4 C24.4 7.6 24.1 7.4 23.8 7.1 C23.5 6.7 23.5 6.3 23.8 6 L24.4 5.2 C24.7 4.7 24.7 4.4 24.5 4.2 C24.3 4 24 3.9 23.5 4.3 L22.7 4.9 C22.4 5.2 22 5.2 21.6 4.9 C21.2 4.6 21.1 4.2 21.3 3.8 L21.7 2.9 C21.9 2.3 21.8 2.1 21.5 1.9 C21.2 1.7 20.9 1.8 20.6 2.2 L20 3.1 C19.7 3.4 19.3 3.5 18.9 3.3 C18.4 3.1 18.2 2.8 18.3 2.4 L18.5 1.3 C18.5 .8 18.4 .6 18 .5 C17.7 .4 17.5 .6 17.3 1 L16.9 2 C16.7 2.4 16.4 2.6 15.9 2.5 C15.4 2.5 15.1 2.2 15.1 1.7 L15 .7 C14.9 .2 14.7 0 14.3 0 C14 0 13.8 .2 13.7 .7 L13.6 1.8 C13.5 2.2 13.3 2.5 12.8 2.5 C12.3 2.6 12 2.4 11.8 2 L11.4 1 C11.2 .6 11 .4 10.6 .5 C10.3 .6 10.1 .9 10.2 1.4 L10.4 2.4 C10.4 2.8 10.2 3.1 9.8 3.3 C9.3 3.5 9 3.4 8.7 3.1 L8.1 2.2 C7.8 1.8 7.5 1.8 7.2 1.9 C6.9 2.1 6.8 2.3 7 2.9 L7.4 3.8 C7.6 4.2 7.5 4.6 7.1 4.9 C6.7 5.2 6.3 5.2 5.9 4.9 L5.1 4.3 C4.7 4 4.4 3.9 4.2 4.2 C3.9 4.5 4 4.7 4.3 5.1 L4.9 5.9 C5.2 6.3 5.2 6.7 4.9 7.1 C4.6 7.5 4.3 7.6 3.8 7.4 L2.9 7 C2.4 6.8 2.1 6.9 1.9 7.2 C1.7 7.5 1.8 7.8 2.2 8.1 L3.1 8.7 C3.4 9 3.5 9.3 3.3 9.8 C3.1 10.2 2.8 10.4 2.4 10.4 L1.3 10.2 C.8 10.1 .6 10.3 .5 10.6 C.4 10.9 .5 11.2 1 11.4 L2 11.8 C2.4 12 2.6 12.3 2.5 12.8 C2.4 13.2 2.2 13.5 1.7 13.6 L.7 13.7 C.2 13.8 0 14 0 14.3 C0 14.6 .2 14.9 .7 14.9 L1.7 15.1 C2.2 15.1 2.4 15.4 2.5 15.9 C2.6 16.3 2.4 16.7 2 16.9 L1 17.2 C.5 17.5 .4 17.7 .5 18 C.6 18.3 .8 18.5 1.3 18.4 L2.4 18.3 C2.8 18.2 3.1 18.4 3.3 18.9 C3.5 19.3 3.4 19.7 3.1 20 L2.2 20.6 C1.8 20.9 1.8 21.2 1.9 21.5 C2.1 21.8 2.3 21.9 2.9 21.7 L3.8 21.2 C4.2 21.1 4.6 21.2 4.9 21.6 C5.2 21.9 5.2 22.3 4.9 22.7 L4.3 23.5 C3.9 23.9 4 24.2 4.2 24.5 C4.4 24.7 4.7 24.7 5.1 24.4 L5.9 23.7 C6.3 23.4 6.7 23.5 7.1 23.8 C7.5 24.1 7.6 24.4 7.4 24.8 L7 25.8 C6.8 26.3 6.9 26.6 7.2 26.7 C7.5 26.9 7.7 26.9 8.1 26.4 L8.7 25.6 C9 25.2 9.3 25.1 9.8 25.3 C10.2 25.5 10.4 25.8 10.4 26.3 L10.2 27.3 C10.1 27.8 10.3 28.1 10.6 28.2 C10.9 28.2 11.2 28.1 11.4 27.6 L11.8 26.7 C12 26.3 12.3 26.1 12.8 26.1 C13.3 26.2 13.5 26.4 13.6 26.9 L13.7 27.9 C13.8 28.5 14 28.6 14.3 28.6 ZM7.2 21.9 C5.1 20 3.9 17.3 3.9 14.3 C3.9 11.3 5.1 8.6 7.2 6.7 C7.9 6 8.7 6.1 9.2 7 L12.8 13.3 C13.2 14 13.2 14.7 12.8 15.4 L9.2 21.6 C8.7 22.5 7.9 22.6 7.2 21.9 ZM14.3 24.7 C13.2 24.7 12.2 24.6 11.2 24.3 C10.2 24 10 23.3 10.5 22.4 L14.1 16.2 C14.6 15.4 15.1 15.1 16 15.1 L23.2 15.1 C24.2 15.1 24.7 15.7 24.4 16.7 C23.3 21.3 19.2 24.7 14.3 24.7 ZM14.3 15 C13.9 15 13.6 14.7 13.6 14.3 C13.6 14 13.9 13.7 14.3 13.7 C14.6 13.7 14.9 14 14.9 14.3 C14.9 14.7 14.6 15 14.3 15 ZM16 13.6 C15.1 13.6 14.6 13.2 14.1 12.5 L10.5 6.2 C10 5.4 10.3 4.6 11.2 4.4 C12.2 4.1 13.2 3.9 14.3 3.9 C19.2 3.9 23.4 7.3 24.4 12 C24.7 13 24.2 13.6 23.2 13.6 Z" />
    </Glyph>
  );
}

export function Settings(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleSettings {...props} /> : (
    <Icon {...props}>
      <path d="M10.25 2.56L13.75 2.56L13.87 4.79L15.78 5.58L17.44 4.09L19.91 6.56L18.42 8.22L19.21 10.13L21.44 10.25L21.44 13.75L19.21 13.87L18.42 15.78L19.91 17.44L17.44 19.91L15.78 18.42L13.87 19.21L13.75 21.44L10.25 21.44L10.13 19.21L8.22 18.42L6.56 19.91L4.09 17.44L5.58 15.78L4.79 13.87L2.56 13.75L2.56 10.25L4.79 10.13L5.58 8.22L4.09 6.56L6.56 4.09L8.22 5.58L10.13 4.79Z" />
      <circle cx="12" cy="12" r="3.15" />
    </Icon>
  );
}

/* ── Top bar and toolbar ────────────────────────────────────────────────────── */

export function Search(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.3" />
      <path d="M15.7 15.7 20.5 20.5" />
    </Icon>
  );
}

export function Menu(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 7.2h15M4.5 12h15M4.5 16.8h15" />
    </Icon>
  );
}

export function CircleHelp(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M9.6 9.4a2.5 2.5 0 0 1 4.9.5c0 1.7-2.4 2.1-2.4 3.6" />
      <path d="M12.05 16.9h.01" />
    </Icon>
  );
}

export function UserRound(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="9.8" r="2.7" />
      <path d="M6.9 18a6.6 6.6 0 0 1 10.2 0" />
    </Icon>
  );
}

export function LockKeyhole(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="5.2" y="10.4" width="13.6" height="9.6" rx="2.6" />
      <path d="M8.5 10.4V8a3.5 3.5 0 0 1 7 0v2.4" />
      <circle cx="12" cy="15.2" r="1.05" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.8 9.6 5.2 5.2 5.2-5.2" />
    </Icon>
  );
}

export function ChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.8 14.4 5.2-5.2 5.2 5.2" />
    </Icon>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.2 12H5.3" />
      <path d="m10.9 6.9-5.1 5.1 5.1 5.1" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5.2v13.6M5.2 12h13.6" />
    </Icon>
  );
}

export function X(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.6 6.6 17.4 17.4M17.4 6.6 6.6 17.4" />
    </Icon>
  );
}

export function Upload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5.6 14.6v3.2a2.1 2.1 0 0 0 2.1 2.1h8.6a2.1 2.1 0 0 0 2.1-2.1v-3.2" />
      <path d="M12 13.6V4.8" />
      <path d="m8.3 8.5 3.7-3.7 3.7 3.7" />
    </Icon>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5.2 12.5 4.5 4.5L18.8 8" />
    </Icon>
  );
}

export function MoreHorizontal(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.4" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.6" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function ApplePencil(props: IconProps) {
  return (
    <Glyph frame="0 0 20.3949 19.9823" {...props}>
      <path d="M3.2 18.8 17.3 4.7 15.3 2.7 1.2 16.8 0 19.5 C-.1 19.8 .2 20.1 .5 20 ZM18.4 3.7 19.6 2.6 C20.2 1.9 20.2 1.3 19.7 .8 L19.3 .4 C18.8-.1 18.1-.1 17.5 .5 L16.3 1.7 Z" />
    </Glyph>
  );
}

export function Pencil(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <ApplePencil {...props} /> : (
    <Icon {...props}>
      <path d="M4.3 19.7l.8-3.6L15.9 5.1a2.2 2.2 0 0 1 3.1 3.1L8.1 18.9l-3.8.8Z" />
      <path d="m14.4 6.6 3 3" />
    </Icon>
  );
}

export function SlidersHorizontal(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h6.2M14.8 7H20" />
      <circle cx="12.5" cy="7" r="2.3" />
      <path d="M4 12h2.7M11.3 12H20" />
      <circle cx="9" cy="12" r="2.3" />
      <path d="M4 17h8.7M17.3 17H20" />
      <circle cx="15" cy="17" r="2.3" />
    </Icon>
  );
}

export function Sparkles(props: IconProps) {
  return (
    <Icon {...props}>
      <path
        d="M15.5 9.9C15.5 10.27 11.93 10.06 11 11C10.06 11.93 10.27 15.5 9.9 15.5C9.53 15.5 9.74 11.93 8.8 11C7.87 10.06 4.3 10.27 4.3 9.9C4.3 9.53 7.87 9.74 8.8 8.8C9.74 7.87 9.53 4.3 9.9 4.3C10.27 4.3 10.06 7.87 11 8.8C11.93 9.74 15.5 9.53 15.5 9.9Z"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M15.5 9.9C15.5 10.27 11.93 10.06 11 11C10.06 11.93 10.27 15.5 9.9 15.5C9.53 15.5 9.74 11.93 8.8 11C7.87 10.06 4.3 10.27 4.3 9.9C4.3 9.53 7.87 9.74 8.8 8.8C9.74 7.87 9.53 4.3 9.9 4.3C10.27 4.3 10.06 7.87 11 8.8C11.93 9.74 15.5 9.53 15.5 9.9Z"
        transform="translate(17.9 6.7) scale(.42) translate(-9.9 -9.9)"
        fill="currentColor"
        stroke="none"
      />
      <path
        d="M15.5 9.9C15.5 10.27 11.93 10.06 11 11C10.06 11.93 10.27 15.5 9.9 15.5C9.53 15.5 9.74 11.93 8.8 11C7.87 10.06 4.3 10.27 4.3 9.9C4.3 9.53 7.87 9.74 8.8 8.8C9.74 7.87 9.53 4.3 9.9 4.3C10.27 4.3 10.06 7.87 11 8.8C11.93 9.74 15.5 9.53 15.5 9.9Z"
        transform="translate(17.1 17.2) scale(.3) translate(-9.9 -9.9)"
        fill="currentColor"
        stroke="none"
      />
    </Icon>
  );
}

/* ── Files and media ────────────────────────────────────────────────────────── */

export function FileAudio(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 10.1v3.8M8.1 7.2v9.6M11.6 5.2v13.6M15.1 8.2v7.6M18.6 10.5v3" />
    </Icon>
  );
}

export function FolderOpen(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 17.9V7.2a2.3 2.3 0 0 1 2.3-2.3h2.5c.7 0 1.4.3 1.9.9l.6.7c.5.6 1.2.9 2 .9h6.4a2.3 2.3 0 0 1 2.3 2.3v8.2a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3Z" />
    </Icon>
  );
}

export function FileVideo(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.6" y="5.5" width="16.8" height="13" rx="3.2" />
      <path d="M10.5 9.5v5c0 .8.9 1.3 1.6.9l4.1-2.5c.7-.4.7-1.4 0-1.8l-4.1-2.5c-.7-.4-1.6.1-1.6.9Z" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ListMusic(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.5" cy="7" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9.6 7h8.4M9.6 12h5.4" />
      <ellipse cx="16.4" cy="17.4" rx="2.3" ry="1.85" transform="rotate(-25 16.4 17.4)" fill="currentColor" stroke="none" />
      <path d="M18.7 17V9.4" />
      <path d="M18.7 9.4c1.7-.5 3.1.3 3.1 1.7" />
    </Icon>
  );
}

export function Layers3(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m12 3.9 6.6 3.4L12 10.7 5.4 7.3Z" />
      <path d="m5.4 12 6.6 3.4 6.6-3.4" />
      <path d="m5.4 16.3 6.6 3.4 6.6-3.4" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleActivity(props: IconProps) {
  return (
    <Glyph frame="0 0 22.8711 26.0645" {...props}>
      <path d="M21.7 17.2 C22.1 17.2 22.5 16.8 22.5 16.3 L22.5 9.8 C22.5 9.3 22.1 8.9 21.7 8.9 C21.2 8.9 20.8 9.3 20.8 9.8 L20.8 16.3 C20.8 16.8 21.2 17.2 21.7 17.2 Z" />
      <path d="M17.5 23.1 C18 23.1 18.4 22.7 18.4 22.2 L18.4 3.8 C18.4 3.3 18 2.9 17.5 2.9 C17 2.9 16.6 3.3 16.6 3.8 L16.6 22.2 C16.6 22.7 17 23.1 17.5 23.1 Z" />
      <path d="M13.3 19.6 C13.8 19.6 14.2 19.2 14.2 18.7 L14.2 7.4 C14.2 6.9 13.8 6.5 13.3 6.5 C12.8 6.5 12.5 6.9 12.5 7.4 L12.5 18.7 C12.5 19.2 12.8 19.6 13.3 19.6 Z" />
      <path d="M9.2 26.1 C9.7 26.1 10 25.7 10 25.2 L10 .9 C10 .4 9.7 0 9.2 0 C8.7 0 8.3 .4 8.3 .9 L8.3 25.2 C8.3 25.7 8.7 26.1 9.2 26.1 Z" />
      <path d="M5 21 C5.5 21 5.9 20.6 5.9 20.1 L5.9 5.9 C5.9 5.5 5.5 5.1 5 5.1 C4.5 5.1 4.2 5.5 4.2 5.9 L4.2 20.1 C4.2 20.6 4.5 21 5 21 Z" />
      <path d="M.9 16 C1.4 16 1.7 15.6 1.7 15.2 L1.7 10.9 C1.7 10.4 1.4 10 .9 10 C.4 10 0 10.4 0 10.9 L0 15.2 C0 15.6 .4 16 .9 16 Z" />
    </Glyph>
  );
}

export function Activity(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleActivity {...props} /> : (
    <Icon {...props}>
      <path d="M3.8 12.2h2.9l2-5.8 3.5 11 2.3-7 1.6 3.7 1.3-1.9h4.8" />
    </Icon>
  );
}

export function Maximize2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.6 4.6H4.6v5" />
      <path d="M4.9 4.9 10.3 10.3" />
      <path d="M14.4 19.4h5v-5" />
      <path d="M19.1 19.1 13.7 13.7" />
    </Icon>
  );
}

export function Video(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.4" y="5.8" width="12.8" height="12.4" rx="3" />
      <path d="m16.2 11 4.4-2.6v7.2L16.2 13" />
    </Icon>
  );
}

/* ── Transport and sound ────────────────────────────────────────────────────── */

export function Play(props: IconProps) {
  return <PlayGlyph size={props.size ?? 24} />;
}

export function Pause(props: IconProps) {
  return <PauseGlyph size={props.size ?? 24} />;
}

/** The SF Symbols export's fill variant — Apple platforms only, see `useAppleGlyphs`. */
function AppleSkipBack(props: IconProps) {
  return (
    <Glyph frame="0 0 36.4648 18.9746" {...props}>
      <path d="M33.5 17.4L33.5 1.6C33.5 .5 32.8 0 32.1 0C31.8 0 31.4 .1 31.1 .3L17.9 8C17 8.5 16.7 8.9 16.7 9.5C16.7 10.1 17 10.4 17.9 10.9L31.1 18.7C31.4 18.9 31.8 19 32.1 19C32.8 19 33.5 18.5 33.5 17.4ZM16.8 17.4L16.8 1.6C16.8 .5 16.1 0 15.4 0C15.1 0 14.7 .1 14.4 .3L1.2 8C.3 8.5 0 8.9 0 9.5C0 10.1 .3 10.4 1.2 10.9L14.4 18.7C14.7 18.9 15.1 19 15.4 19C16.1 19 16.8 18.5 16.8 17.4Z" />
    </Glyph>
  );
}

export function SkipBack(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleSkipBack {...props} /> : (
    <Icon {...props}>
      <path d="M6.9 6.2v11.6" />
      <path d="M18.3 7.4v9.2c0 1.2-1.3 1.9-2.3 1.3l-7-4.6a1.55 1.55 0 0 1 0-2.6l7-4.6c1-.6 2.3.1 2.3 1.3Z" fill="currentColor" />
    </Icon>
  );
}

/** The SF Symbols export's fill variant — Apple platforms only, see `useAppleGlyphs`. */
function AppleSkipForward(props: IconProps) {
  return (
    <Glyph frame="0 0 35.7422 18.9746" {...props}>
      <path d="M2.3 17.4C2.3 18.5 2.9 19 3.6 19C4 19 4.3 18.9 4.6 18.7L17.9 10.9C18.7 10.4 19 10.1 19 9.5C19 8.9 18.7 8.5 17.9 8L4.6 .3C4.3 .1 4 0 3.6 0C2.9 0 2.3 .5 2.3 1.6ZM19 17.4C19 18.5 19.6 19 20.4 19C20.7 19 21 18.9 21.3 18.7L34.6 10.9C35.4 10.4 35.7 10.1 35.7 9.5C35.7 8.9 35.4 8.5 34.6 8L21.3 .3C21 .1 20.7 0 20.4 0C19.6 0 19 .5 19 1.6Z" />
    </Glyph>
  );
}

export function SkipForward(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleSkipForward {...props} /> : (
    <Icon {...props}>
      <path d="M17.1 6.2v11.6" />
      <path d="M5.7 7.4v9.2c0 1.2 1.3 1.9 2.3 1.3l7-4.6a1.55 1.55 0 0 0 0-2.6l-7-4.6c-1-.6-2.3.1-2.3 1.3Z" fill="currentColor" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleShuffle(props: IconProps) {
  return (
    <Glyph frame="0 0 28.5645 22.373" {...props}>
      <path d="M21.9 .7 21.9 8.6 C21.9 9 22.1 9.3 22.6 9.3 C22.8 9.3 23 9.2 23.2 9.1 L27.9 5.2 C28.3 4.9 28.3 4.4 27.9 4.1 L23.2 .2 C23 .1 22.8 0 22.6 0 C22.1 0 21.9 .3 21.9 .7 ZM0 17.6 C0 18.1 .4 18.5 1 18.5 L3.9 18.5 C5.9 18.5 7.1 17.9 8.5 16.2 L16 7.5 C17.1 6.2 18 5.7 19.4 5.7 L23.7 5.7 C24.2 5.7 24.7 5.3 24.7 4.8 C24.7 4.2 24.2 3.8 23.7 3.8 L19.4 3.8 C17.3 3.8 16.2 4.4 14.7 6.1 L7.2 14.9 C6.1 16.2 5.2 16.6 3.9 16.6 L1 16.6 C.4 16.6 0 17 0 17.6 ZM21.9 21.7 C21.9 22.1 22.1 22.4 22.6 22.4 C22.8 22.4 23 22.3 23.2 22.2 L27.9 18.3 C28.3 18 28.3 17.5 27.9 17.2 L23.2 13.3 C23 13.2 22.8 13.1 22.6 13.1 C22.1 13.1 21.9 13.4 21.9 13.8 ZM0 4.8 C0 5.4 .4 5.8 1 5.8 L3.9 5.8 C5.2 5.8 6.1 6.2 7.2 7.5 L14.7 16.3 C16.2 18 17.3 18.6 19.4 18.6 L23.7 18.6 C24.2 18.6 24.7 18.2 24.7 17.6 C24.7 17.1 24.2 16.7 23.7 16.7 L19.4 16.7 C18 16.7 17.1 16.2 16 14.9 L8.5 6.2 C7.1 4.5 5.9 3.9 3.9 3.9 L1 3.9 C.4 3.9 0 4.3 0 4.8 Z" />
    </Glyph>
  );
}

export function Shuffle(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleShuffle {...props} /> : (
    <Icon {...props}>
      <path d="m17.3 4.7 3.2 3.2-3.2 3.2" />
      <path d="M20.5 7.9h-3.4c-1.4 0-2.7.6-3.5 1.7l-3.2 4.5a4.5 4.5 0 0 1-3.7 1.8H4.5" />
      <path d="m17.3 13.4 3.2 3.2-3.2 3.2" />
      <path d="M20.5 16.6h-3.4c-1.4 0-2.7-.6-3.5-1.7l-.4-.5" />
      <path d="M4.5 7.9h2.2c1.5 0 2.9.7 3.7 1.9l.4.6" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleRepeat(props: IconProps) {
  return (
    <Glyph frame="0 0 26.5137 22.041" {...props}>
      <path d="M10.8 21.3 10.8 13.5 C10.8 13 10.6 12.8 10.1 12.8 C9.9 12.8 9.7 12.9 9.5 13 L4.8 16.8 C4.4 17.1 4.4 17.7 4.8 18 L9.5 21.8 C9.7 22 9.9 22 10.1 22 C10.6 22 10.8 21.8 10.8 21.3 ZM25.2 10.7 C24.7 10.7 24.3 11.1 24.3 11.6 L24.3 12.8 C24.3 15 22.8 16.5 20.4 16.5 L9 16.5 C8.5 16.5 8.1 16.9 8.1 17.4 C8.1 17.9 8.5 18.3 9 18.3 L20.2 18.3 C23.9 18.3 26.2 16.3 26.2 12.9 L26.2 11.6 C26.2 11.1 25.8 10.7 25.2 10.7 Z" />
      <path d="M15.3 .7 15.3 8.6 C15.3 9 15.6 9.3 16 9.3 C16.2 9.3 16.4 9.2 16.6 9.1 L21.3 5.2 C21.7 4.9 21.7 4.4 21.3 4.1 L16.6 .2 C16.4 .1 16.2 0 16 0 C15.6 0 15.3 .3 15.3 .7 ZM.9 11.4 C1.5 11.4 1.9 11 1.9 10.5 L1.9 9.3 C1.9 7 3.4 5.6 5.8 5.6 L17.2 5.6 C17.7 5.6 18.1 5.2 18.1 4.7 C18.1 4.2 17.7 3.8 17.2 3.8 L5.9 3.8 C2.3 3.8 0 5.8 0 9.2 L0 10.5 C0 11 .4 11.4 .9 11.4 Z" />
    </Glyph>
  );
}

export function Repeat(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleRepeat {...props} /> : (
    <Icon {...props}>
      <path d="M3.4 12.6v-1.5a3.8 3.8 0 0 1 3.8-3.8h13.4" />
      <path d="m17.3 4.1 3.3 3.2-3.3 3.2" />
      <path d="M20.6 11.4v1.5a3.8 3.8 0 0 1-3.8 3.8H3.4" />
      <path d="m6.7 13.5-3.3 3.2 3.3 3.2" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleVolume2(props: IconProps) {
  return (
    <Glyph frame="0 0 28.0469 21.9434" {...props}>
      <path d="M23.9 19.6 C24.3 19.9 24.8 19.8 25.1 19.4 C26.7 17.2 27.7 14.1 27.7 11 C27.7 7.8 26.7 4.7 25.1 2.6 C24.8 2.2 24.3 2.1 23.9 2.3 C23.5 2.6 23.5 3.1 23.8 3.6 C25.2 5.6 26 8.2 26 11 C26 13.7 25.2 16.4 23.8 18.4 C23.5 18.8 23.5 19.3 23.9 19.6 Z" />
      <path d="M19.4 16.3 C19.8 16.5 20.3 16.5 20.6 16 C21.5 14.8 22.1 12.9 22.1 11 C22.1 9 21.5 7.2 20.6 5.9 C20.3 5.5 19.8 5.4 19.4 5.6 C19 5.9 18.9 6.5 19.2 6.9 C20 8 20.5 9.4 20.5 11 C20.5 12.5 20 13.9 19.2 15 C18.9 15.5 19 16 19.4 16.3 Z" />
      <path d="M2.3 15.9 6 15.9 C6.2 15.9 6.3 16 6.4 16.1 L12.2 21.2 C12.7 21.7 13.1 21.9 13.7 21.9 C14.4 21.9 14.9 21.4 14.9 20.6 L14.9 1.4 C14.9 .6 14.4 0 13.6 0 C13.1 0 12.7 .3 12.2 .8 L6.4 5.9 C6.3 6 6.2 6.1 6 6.1 L2.3 6.1 C.8 6.1 0 6.9 0 8.5 L0 13.5 C0 15.2 .8 15.9 2.3 15.9 ZM2.4 14.4 C1.9 14.4 1.7 14.1 1.7 13.6 L1.7 8.4 C1.7 7.9 1.9 7.6 2.4 7.6 L6.4 7.6 C6.8 7.6 7 7.6 7.3 7.3 L12.8 2.3 C12.9 2.2 13 2.2 13.1 2.2 C13.2 2.2 13.3 2.2 13.3 2.4 L13.3 19.6 C13.3 19.7 13.2 19.8 13.1 19.8 C13 19.8 12.9 19.7 12.9 19.7 L7.3 14.7 C7 14.4 6.8 14.4 6.4 14.4 Z" />
    </Glyph>
  );
}

export function Volume2(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleVolume2 {...props} /> : (
    <Icon {...props}>
      <path d="M11.4 5.7 7.5 8.9H4.9a.9.9 0 0 0-.9.9v4.4c0 .5.4.9.9.9h2.6l3.9 3.2c.6.5 1.5.1 1.5-.7V6.4c0-.8-.9-1.2-1.5-.7Z" />
      <path d="M15.3 9.5a3.9 3.9 0 0 1 0 5" />
      <path d="M17.9 7.3a7.1 7.1 0 0 1 0 9.4" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleVolumeX(props: IconProps) {
  return (
    <Glyph frame="0 0 17.8711 21.9434" {...props}>
      <path d="M2.3 15.9 6 15.9 C6.2 15.9 6.3 16 6.4 16.1 L12.2 21.2 C12.7 21.7 13.1 21.9 13.7 21.9 C14.4 21.9 14.9 21.4 14.9 20.6 L14.9 1.4 C14.9 .6 14.4 0 13.6 0 C13.1 0 12.7 .3 12.2 .8 L6.4 5.9 C6.3 6 6.2 6.1 6 6.1 L2.3 6.1 C.8 6.1 0 6.9 0 8.5 L0 13.5 C0 15.2 .8 15.9 2.3 15.9 ZM2.4 14.4 C1.9 14.4 1.7 14.1 1.7 13.6 L1.7 8.4 C1.7 7.9 1.9 7.6 2.4 7.6 L6.4 7.6 C6.8 7.6 7 7.6 7.3 7.3 L12.8 2.3 C12.9 2.2 13 2.2 13.1 2.2 C13.2 2.2 13.3 2.2 13.3 2.4 L13.3 19.6 C13.3 19.7 13.2 19.8 13.1 19.8 C13 19.8 12.9 19.7 12.9 19.7 L7.3 14.7 C7 14.4 6.8 14.4 6.4 14.4 Z" />
    </Glyph>
  );
}

export function VolumeX(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleVolumeX {...props} /> : (
    <Icon {...props}>
      <path d="M11.4 5.7 7.5 8.9H4.9a.9.9 0 0 0-.9.9v4.4c0 .5.4.9.9.9h2.6l3.9 3.2c.6.5 1.5.1 1.5-.7V6.4c0-.8-.9-1.2-1.5-.7Z" />
      <path d="M15.6 9.4 20.4 14.6" />
    </Icon>
  );
}

/* ── Editor actions ─────────────────────────────────────────────────────────── */

export function Download(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4.4v10.4" />
      <path d="m7.8 10.7 4.2 4.2 4.2-4.2" />
      <path d="M4.8 19.6h14.4" />
    </Icon>
  );
}

export function FileUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 15.4V5" />
      <path d="m7.8 9.2 4.2-4.2 4.2 4.2" />
      <path d="M4.8 19.6h14.4" />
    </Icon>
  );
}

export function Undo2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.2 6.4-4.2 4.2 4.2 4.2" />
      <path d="M5 10.6h9.4a4.4 4.4 0 0 1 0 8.8h-3.6" />
    </Icon>
  );
}

export function Redo2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m14.8 6.4 4.2 4.2-4.2 4.2" />
      <path d="M19 10.6h-9.4a4.4 4.4 0 0 0 0 8.8h3.6" />
    </Icon>
  );
}

/* ── Panels and speech ──────────────────────────────────────────────────────── */

export function List(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.5" cy="6.8" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="5.5" cy="17.2" r="1.25" fill="currentColor" stroke="none" />
      <path d="M9.6 6.8h9M9.6 12h9M9.6 17.2h9" />
    </Icon>
  );
}

/** The SF Symbols export — Apple platforms only, see `useAppleGlyphs`. */
function AppleMessageSquareQuote(props: IconProps) {
  return (
    <Glyph frame="0 0 27.8711 27.2754" {...props}>
      <path d="M7.4 27.3 C8 27.3 8.3 27 9 26.4 L13.4 22.5 22 22.5 C25.5 22.5 27.5 20.5 27.5 17.1 L27.5 7.1 C27.5 3.6 25.5 1.6 22 1.6 L5.5 1.6 C2 1.6 0 3.6 0 7.1 L0 17.1 C0 20.5 2 22.5 5.5 22.5 L6.2 22.5 6.2 25.9 C6.2 26.7 6.7 27.3 7.4 27.3 ZM7.9 25.3 7.9 21.6 C7.9 21 7.6 20.8 7 20.8 L5.5 20.8 C3 20.8 1.7 19.5 1.7 17 L1.7 7.1 C1.7 4.7 3 3.3 5.5 3.3 L22 3.3 C24.5 3.3 25.8 4.7 25.8 7.1 L25.8 17 C25.8 19.5 24.5 20.8 22 20.8 L13.3 20.8 C12.7 20.8 12.4 20.9 12 21.4 Z" />
      <path d="M7.7 10.8 C7.7 12.2 8.6 13.3 10 13.3 C10.5 13.3 11.1 13.1 11.4 12.7 L11.5 12.7 C11 13.8 10 14.5 9.2 14.7 C8.8 14.8 8.6 15 8.6 15.3 C8.6 15.6 8.9 15.9 9.2 15.9 C10.4 15.9 13 14.4 13 11.2 C13 9.5 11.9 8.2 10.3 8.2 C8.8 8.2 7.7 9.3 7.7 10.8 ZM14.5 10.8 C14.5 12.2 15.4 13.3 16.8 13.3 C17.4 13.3 17.9 13.1 18.2 12.7 L18.3 12.7 C17.9 13.8 16.8 14.5 16.1 14.7 C15.6 14.8 15.5 15 15.5 15.3 C15.5 15.6 15.7 15.9 16.1 15.9 C17.3 15.9 19.9 14.4 19.9 11.2 C19.9 9.5 18.7 8.2 17.1 8.2 C15.6 8.2 14.5 9.3 14.5 10.8 Z" />
    </Glyph>
  );
}

export function MessageSquareQuote(props: IconProps) {
  const apple = useAppleGlyphs();
  return apple ? <AppleMessageSquareQuote {...props} /> : (
    <Icon {...props}>
      <path d="M4.6 7.7a3.1 3.1 0 0 1 3.1-3.1h8.6a3.1 3.1 0 0 1 3.1 3.1v6a3.1 3.1 0 0 1-3.1 3.1h-3.9l-4.4 3.5v-3.5h-.3a3.1 3.1 0 0 1-3.1-3.1Z" />
      <path d="M9.1 9.6h5.8M9.1 12.8h3.6" />
    </Icon>
  );
}
