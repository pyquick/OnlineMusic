/**
 * The app's own shape for a piece of media, and the index line the server streams for one.
 *
 * These live in shared/ because three layers speak them: the page that stores the list, the
 * features that render it (the parameters screen, the video overlay, the now-playing queue) and
 * the prefetch/transport helpers. The *server's* record is a different, richer thing — see
 * lib/assets.ts — and the index entry below is the deliberately thin projection of it that a
 * list row needs, without file bytes or artwork.
 */
export type MediaKind = "audio" | "video" | "image" | "project";

export type Asset = {
  file: File;
  url: string;
  kind: MediaKind;
  title: string;
  artist: string;
  album: string;
  genre: string;
  metadata: Record<string, unknown>;
  apiId?: string;
};

/** One line of the streamed asset index: everything a list row needs, without file bytes or artwork. */
export type IndexEntry = {
  id: string; name: string; mediaKind: MediaKind; format?: string; title?: string; artist?: string; album?: string;
  genre?: string; trackNo?: number; durationMs?: number; lyrics?: string; sizeBytes?: number; mimeType?: string;
  fileUrl?: string; coverUrl?: string; hasCover?: boolean;
};
