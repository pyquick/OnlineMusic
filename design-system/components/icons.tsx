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
 * Stroke width, caps and joins are defaults: a caller may still override any SVG prop, which is
 * how the now-playing transport asks for `fill="currentColor"` on the solid skips.
 */
import type { SVGProps } from "react";
import { PauseGlyph, PlayGlyph } from "./TransportGlyphs";

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...rest }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
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

/* ── Navigation ─────────────────────────────────────────────────────────────── */

export function House(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.9 11.1 11 4.7a1.55 1.55 0 0 1 2 0l7.1 6.4" />
      <path d="M5.7 9.7V19a1.9 1.9 0 0 0 1.9 1.9h8.8a1.9 1.9 0 0 0 1.9-1.9V9.7" />
      <path d="M9.8 20.9v-4a2.2 2.2 0 0 1 4.4 0v4" />
    </Icon>
  );
}

export function Music2(props: IconProps) {
  return (
    <Icon {...props}>
      <ellipse cx="10.4" cy="16.7" rx="3.1" ry="2.5" transform="rotate(-25 10.4 16.7)" fill="currentColor" stroke="none" />
      <path d="M13.5 16.3V5.4" />
      <path d="M13.5 5.4c2.2-.6 4.3.3 4.3 2.1 0 1.5-1 2.7-2.6 3.5" />
    </Icon>
  );
}

export function Disc3(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M5.6 15.2a6.8 6.8 0 0 0 3.6 3.2" />
    </Icon>
  );
}

export function Library(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4.6" y="5.6" width="3.5" height="13.4" rx="1.3" />
      <rect x="10.25" y="4.4" width="3.5" height="14.6" rx="1.3" />
      <rect x="15.9" y="7.2" width="3.5" height="11.8" rx="1.3" />
    </Icon>
  );
}

export function Settings(props: IconProps) {
  return (
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

export function Pencil(props: IconProps) {
  return (
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

export function Activity(props: IconProps) {
  return (
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

export function SkipBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6.9 6.2v11.6" />
      <path d="M18.3 7.4v9.2c0 1.2-1.3 1.9-2.3 1.3l-7-4.6a1.55 1.55 0 0 1 0-2.6l7-4.6c1-.6 2.3.1 2.3 1.3Z" />
    </Icon>
  );
}

export function SkipForward(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M17.1 6.2v11.6" />
      <path d="M5.7 7.4v9.2c0 1.2 1.3 1.9 2.3 1.3l7-4.6a1.55 1.55 0 0 0 0-2.6l-7-4.6c-1-.6-2.3.1-2.3 1.3Z" />
    </Icon>
  );
}

export function Shuffle(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m17.3 4.7 3.2 3.2-3.2 3.2" />
      <path d="M20.5 7.9h-3.4c-1.4 0-2.7.6-3.5 1.7l-3.2 4.5a4.5 4.5 0 0 1-3.7 1.8H4.5" />
      <path d="m17.3 13.4 3.2 3.2-3.2 3.2" />
      <path d="M20.5 16.6h-3.4c-1.4 0-2.7-.6-3.5-1.7l-.4-.5" />
      <path d="M4.5 7.9h2.2c1.5 0 2.9.7 3.7 1.9l.4.6" />
    </Icon>
  );
}

export function Repeat(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.4 12.6v-1.5a3.8 3.8 0 0 1 3.8-3.8h13.4" />
      <path d="m17.3 4.1 3.3 3.2-3.3 3.2" />
      <path d="M20.6 11.4v1.5a3.8 3.8 0 0 1-3.8 3.8H3.4" />
      <path d="m6.7 13.5-3.3 3.2 3.3 3.2" />
    </Icon>
  );
}

export function Volume2(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M11.4 5.7 7.5 8.9H4.9a.9.9 0 0 0-.9.9v4.4c0 .5.4.9.9.9h2.6l3.9 3.2c.6.5 1.5.1 1.5-.7V6.4c0-.8-.9-1.2-1.5-.7Z" />
      <path d="M15.3 9.5a3.9 3.9 0 0 1 0 5" />
      <path d="M17.9 7.3a7.1 7.1 0 0 1 0 9.4" />
    </Icon>
  );
}

export function VolumeX(props: IconProps) {
  return (
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

export function MessageSquareQuote(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.6 7.7a3.1 3.1 0 0 1 3.1-3.1h8.6a3.1 3.1 0 0 1 3.1 3.1v6a3.1 3.1 0 0 1-3.1 3.1h-3.9l-4.4 3.5v-3.5h-.3a3.1 3.1 0 0 1-3.1-3.1Z" />
      <path d="M9.1 9.6h5.8M9.1 12.8h3.6" />
    </Icon>
  );
}
