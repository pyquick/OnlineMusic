/**
 * The transport's play and pause, drawn rather than taken from the icon set: a filled triangle
 * and a pair of bars with soft corners, the way a player's own controls are cut. The set's play is
 * a sharp-cornered polygon and its pause bars are square, which is exactly what reads as "spiky".
 *
 * They are a design-system primitive because three surfaces show them at three sizes — the bar
 * (26), the video dock (17) and the now-playing disc (40) — and none of them should be drawing a
 * glyph of its own.
 */
export function PlayGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M10.3 6.4 16.7 10.1Q20 12 16.7 13.9L10.3 17.6Q7 19.5 7 15.69L7 8.31Q7 4.5 10.3 6.4Z" />
    </svg>
  );
}

export function PauseGlyph({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6.9" y="5" width="4.1" height="14" rx="2.05" />
      <rect x="13" y="5" width="4.1" height="14" rx="2.05" />
    </svg>
  );
}
