/** Deep links into the source viewer: a moment in a recording or a page (and region) in a document. */
export function sourceHref(
  studySetId: string,
  sourceId: string,
  at: { startMs?: number | null; page?: number | null; anchorId?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (at.startMs !== null && at.startMs !== undefined) params.set("t", (at.startMs / 1000).toFixed(1).replace(/\.0$/, ""));
  else if (at.page !== null && at.page !== undefined) params.set("page", String(at.page));
  if (at.anchorId) params.set("anchor", at.anchorId);
  const qs = params.toString();
  return `/study-sets/${studySetId}/sources/${sourceId}${qs ? `?${qs}` : ""}`;
}

/** Reads ?t= (seconds) safely; returns milliseconds or null. */
export function parseTimeParam(t: string | null | undefined): number | null {
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 && n < 48 * 3600 ? Math.round(n * 1000) : null;
}

/**
 * A short snippet around the first query-term match, with match ranges for
 * highlighting. Pure and dependency-free so it is shared by server and client.
 */
export function makeSnippet(text: string, query: string, width = 220): { text: string; highlights: [number, number][] } {
  const terms = [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []))];
  const flat = text.replace(/\s+/g, " ").trim();
  const lower = flat.toLowerCase();
  const first = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - Math.floor(width / 3));
  const end = Math.min(flat.length, start + width);
  const slice = `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  const sliceLower = slice.toLowerCase();
  const highlights: [number, number][] = [];
  for (const term of terms) {
    let i = sliceLower.indexOf(term);
    while (i >= 0) {
      highlights.push([i, i + term.length]);
      i = sliceLower.indexOf(term, i + term.length);
    }
  }
  highlights.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const h of highlights) {
    const last = merged.at(-1);
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([...h]);
  }
  return { text: slice, highlights: merged };
}
