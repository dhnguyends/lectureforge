/**
 * Excerpt verification. A citation counts only if its excerpt really occurs
 * in the cited passage. Matching tolerates differences that are not changes
 * of meaning — case, whitespace, typographic quotes and dashes, Unicode
 * compatibility forms, speaker labels — and "…" gaps between verbatim pieces.
 */

const MIN_EXCERPT_CHARS = 12;

export function normalizeForMatch(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\[speaker \d+\]\s*/g, "")
    .replace(/\*\*/g, "")
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/[“”«»„]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function pieces(excerpt: string): string[] {
  return excerpt
    .split(/\s*(?:\.\.\.|…|\[\.\.\.\])\s*/)
    .map(normalizeForMatch)
    .filter((p) => p.length >= 3);
}

/** Finds each verbatim piece in order; returns the [start, end) span in normalized text, or null. */
export function findExcerpt(excerpt: string, text: string): { start: number; end: number } | null {
  const parts = pieces(excerpt);
  if (parts.reduce((n, p) => n + p.length, 0) < MIN_EXCERPT_CHARS) return null;
  const haystack = normalizeForMatch(text);
  let cursor = 0;
  let start = -1;
  for (const part of parts) {
    const at = haystack.indexOf(part, cursor);
    if (at === -1) return null;
    if (start === -1) start = at;
    cursor = at + part.length;
  }
  return { start, end: cursor };
}

export function verifyExcerpt(excerpt: string, text: string): boolean {
  return findExcerpt(excerpt, text) !== null;
}

export type TimedSegment = { id: string; index: number; startMs: number; endMs: number; text: string };

/**
 * Narrows a transcript citation from the whole chunk to the segments the
 * excerpt actually spans, so "jump to source" lands on the exact moment.
 */
export function locateInSegments(
  excerpt: string,
  segments: TimedSegment[],
): { startMs: number; endMs: number; first: TimedSegment; last: TimedSegment } | null {
  const ordered = [...segments].sort((a, b) => a.index - b.index);
  const offsets: { seg: TimedSegment; from: number; to: number }[] = [];
  let joined = "";
  for (const seg of ordered) {
    const n = normalizeForMatch(seg.text);
    if (joined) joined += " ";
    offsets.push({ seg, from: joined.length, to: joined.length + n.length });
    joined += n;
  }
  const span = findExcerpt(excerpt, joined);
  if (!span) return null;
  const hit = offsets.filter((o) => o.to > span.start && o.from < span.end);
  if (!hit.length) return null;
  const first = hit[0]!.seg;
  const last = hit.at(-1)!.seg;
  return { startMs: first.startMs, endMs: last.endMs, first, last };
}

export type BoxedLine = { text: string; bbox: [number, number, number, number] };

/**
 * Narrows a document citation from the whole passage to the lines the excerpt
 * spans, returning the union box of those lines (normalised, top-left origin).
 */
export function locateInLines(excerpt: string, lines: BoxedLine[]): [number, number, number, number] | null {
  const offsets: { line: BoxedLine; from: number; to: number }[] = [];
  let joined = "";
  for (const line of lines) {
    const n = normalizeForMatch(line.text);
    if (!n) continue;
    if (joined) joined += " ";
    offsets.push({ line, from: joined.length, to: joined.length + n.length });
    joined += n;
  }
  const span = findExcerpt(excerpt, joined);
  if (!span) return null;
  const hit = offsets.filter((o) => o.to > span.start && o.from < span.end).map((o) => o.line.bbox);
  if (!hit.length) return null;
  return [Math.min(...hit.map((b) => b[0])), Math.min(...hit.map((b) => b[1])), Math.max(...hit.map((b) => b[2])), Math.max(...hit.map((b) => b[3]))];
}

const STOP = new Set("the and for are but not you all any can was one our out has how its may now see two who did get let say she too use with that this from they will what when your which their there been have into than then them these some only also more most such over each just like does why where here very much would could should about because while after before between through".split(" "));

function contentWords(text: string): Set<string> {
  return new Set(
    (normalizeForMatch(text).match(/[\p{L}\p{N}_]{3,}/gu) ?? [])
      .filter((w) => !STOP.has(w))
      .map((w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w)),
  );
}

/**
 * Finds which line of a passage a free-text statement draws on (for citations
 * that come without a verbatim excerpt, e.g. the tutor's [C2] references):
 * the item sharing the most content words with the statement. Returns null
 * when nothing shares at least `min` words, so callers fall back to the whole passage.
 */
export function pinpoint<T extends { text: string }>(statement: string, items: T[], min = 2): T | null {
  const want = contentWords(statement);
  if (!want.size) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    let score = 0;
    for (const w of contentWords(item.text)) if (want.has(w)) score++;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore >= min ? best : null;
}

/** The sentences of a reply that cite a given ref, with refs removed. */
export function sentencesCiting(content: string, ref: string): string {
  return content
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((s) => new RegExp(String.raw`\[[^\]]*\b${ref}\b[^\]]*\]`).test(s))
    .map((s) => s.replace(/\[(?:C\d+)(?:\s*,\s*C\d+)*\]/g, ""))
    .join(" ");
}
