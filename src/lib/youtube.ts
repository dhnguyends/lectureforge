const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"]);

/**
 * Extracts the 11-character video id from a YouTube URL, or returns null.
 * Only well-known YouTube hosts are accepted so this cannot be abused to make
 * the worker fetch arbitrary URLs.
 */
export function parseYouTubeUrl(input: string): { videoId: string; canonicalUrl: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (!HOSTS.has(host)) return null;

  let id: string | null = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1] ?? null;
  } else if (url.pathname === "/watch") {
    id = url.searchParams.get("v");
  } else {
    const [, kind, candidate] = url.pathname.split("/");
    if (kind && ["embed", "shorts", "live", "v"].includes(kind)) id = candidate ?? null;
  }
  if (!id || !VIDEO_ID.test(id)) return null;
  return { videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` };
}
