import { api } from "@/infrastructure/api/client";
import type { LyricsDoc } from "@/shared/lyrics";

/**
 * The lyrics document's two calls. Reading is patient and quiet — a song the account does not
 * own answers 404, which means "no document" here, not an error — and writing hands back the
 * server's own normalised copy so the editor adopts exactly what was stored.
 */
export async function fetchLyricsDoc(apiId: string, signal?: AbortSignal): Promise<LyricsDoc | null> {
  const payload = await api.get<{ doc: LyricsDoc | null } | null>(`/api/assets/${encodeURIComponent(apiId)}/lyrics`, {
    signal,
    allow404: true,
    timeoutMs: 20_000,
  });
  return payload?.doc ?? null;
}

export async function saveLyricsDoc(apiId: string, doc: LyricsDoc): Promise<LyricsDoc> {
  const payload = await api.put<{ doc: LyricsDoc }>(`/api/assets/${encodeURIComponent(apiId)}/lyrics`, doc, { timeoutMs: 20_000 });
  return payload?.doc ?? doc;
}
