export type RawSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
};

export type NormalizedSegment = RawSegment & { index: number };

/**
 * Merges per-part transcription results into one timeline.
 * - shifts each part's segments by the part's start offset
 * - drops empty segments and zero/negative-length timing glitches
 * - drops exact duplicates produced at part boundaries
 * - re-indexes from 0 in time order
 */
export function mergeTranscriptParts(
  parts: { startMs: number; segments: RawSegment[] }[],
  totalDurationMs?: number,
): NormalizedSegment[] {
  const all = parts.flatMap((p) =>
    p.segments.map((s) => ({
      ...s,
      text: s.text.replace(/\s+/g, " ").trim(),
      startMs: Math.max(0, Math.round(s.startMs + p.startMs)),
      endMs: Math.max(0, Math.round(s.endMs + p.startMs)),
    })),
  );
  const cleaned = all
    .filter((s) => s.text.length > 0)
    .map((s) => {
      let endMs = Math.max(s.endMs, s.startMs + 1);
      if (totalDurationMs !== undefined) endMs = Math.min(endMs, totalDurationMs);
      return { ...s, endMs };
    })
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const out: NormalizedSegment[] = [];
  for (const s of cleaned) {
    const prev = out.at(-1);
    if (prev && prev.text === s.text && s.startMs < prev.endMs) continue;
    out.push({ ...s, index: out.length });
  }
  return out;
}
