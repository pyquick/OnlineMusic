const audioExtensions = new Set(["mp3", "m4a", "mp4", "flac", "ogg", "oga", "opus", "aac", "wma", "wav", "aiff"]);

export type EmbeddedTags = {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
  coverData?: string;
  trackNo?: number;
  lyrics?: string;
};

function pictureToDataUrl(picture: { format: string; data: Uint8Array }): string | undefined {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < picture.data.length; offset += chunkSize) {
    const chunk: number[] = [];
    for (let index = offset; index < Math.min(offset + chunkSize, picture.data.length); index += 1) chunk.push(picture.data[index]);
    binary += String.fromCharCode(...chunk);
  }
  try {
    return `data:${picture.format || "image/jpeg"};base64,${btoa(binary)}`;
  } catch {
    return undefined;
  }
}

/** Plain-text lyrics from the file's tags: synced lyrics are flattened to their text lines. */
function lyricsText(lyrics: { text?: string; syncText?: { text?: string }[] }[] | undefined): string | undefined {
  if (!lyrics?.length) return undefined;
  const lines = lyrics.flatMap((entry) => {
    if (entry.text?.trim()) return entry.text.trim().split(/\r?\n/);
    if (entry.syncText?.length) return entry.syncText.map((line) => line.text?.trim() ?? "").filter(Boolean);
    return [];
  }).map((line) => line.trim()).filter(Boolean);
  return lines.length ? lines.join("\n") : undefined;
}

/** Reads the tags a file carries itself. Returns {} when the file has none, is not audio, or cannot be parsed. */
export async function readEmbeddedTags(file: File): Promise<EmbeddedTags> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!audioExtensions.has(extension)) return {};
  try {
    const { parseBlob, selectCover } = await import("music-metadata");
    const { common } = await parseBlob(file);
    const cover = selectCover(common.picture);
    const tags: EmbeddedTags = {
      title: common.title?.trim() || undefined,
      artist: common.artist?.trim() || undefined,
      album: common.album?.trim() || undefined,
      genre: common.genre?.[0]?.trim() || undefined,
      coverData: cover ? pictureToDataUrl(cover) : undefined,
      trackNo: common.track?.no ?? undefined,
      lyrics: lyricsText(common.lyrics),
    };
    return tags;
  } catch {
    return {};
  }
}
