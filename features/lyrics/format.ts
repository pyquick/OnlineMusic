/** The editor's time readout: millisecond precision, because that is what the tap keys edit. */
export function stampText(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "–:––.–––";
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}

/**
 * The same stamp, read back: `m:ss.mmm` as the fields print it, or bare seconds — `30.474` is
 * understood as `0:30.474`, so a value can be typed either way. The seconds part is a number,
 * not a field of its own: `0:75.5` reads as 75.5 seconds, and the field prints it back as
 * `1:15.500`, which is what keeps a stored time from ever showing 60 or more in the seconds.
 * Anything unreadable — empty, letters, two colons — answers null, which the field treats as
 * "leave the time as it was" rather than as zero.
 */
export function parseStamp(input: string): number | null {
  const text = input.trim().replace("：", ":");
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 2 || parts.some((part) => part.trim() === "")) return null;
  const seconds = Number(parts[parts.length - 1]);
  const minutes = parts.length === 2 ? Number(parts[0]) : 0;
  if (!Number.isFinite(seconds) || !Number.isFinite(minutes) || seconds < 0 || minutes < 0) return null;
  return Math.round((minutes * 60 + seconds) * 1000) / 1000;
}
