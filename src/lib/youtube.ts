export const YT_REGEX =
  /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function extractVideoId(raw: string): string | null {
  const m = YT_REGEX.exec(raw.trim());
  return m ? m[1] : null;
}

export function canonicalYouTubeUrl(raw: string): string | null {
  const id = extractVideoId(raw);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}
