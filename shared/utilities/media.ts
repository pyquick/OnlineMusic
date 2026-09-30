/**
 * The artwork a card shows for an item: an inline cover for a local import, a lazily fetched
 * cover URL for a stored asset, or nothing (the caller draws its own glyph).
 */
export function coverSrc(item: { metadata: Record<string, unknown> }) {
  const value = item.metadata.coverData || item.metadata.coverUrl;
  return typeof value === "string" && value ? value : "";
}
