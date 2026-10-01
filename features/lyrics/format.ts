/** The editor's time readout: millisecond precision, because that is what the tap keys edit. */
export function stampText(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "–:––.–––";
  const value = Math.max(0, seconds);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(3).padStart(6, "0")}`;
}
