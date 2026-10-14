import { estimateTokens } from "./tokens";

export type TranscriptSegmentInput = {
  index: number;
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
};

export type TranscriptChunk = {
  firstSegment: number;
  lastSegment: number;
  startMs: number;
  endMs: number;
  text: string;
  tokenCount: number;
  speakers: string[];
};

export type TranscriptChunkOptions = {
  /** Start looking for a natural boundary once a chunk reaches this size. */
  targetTokens: number;
  /** Hard cut, even mid-thought. */
  maxTokens: number;
  /** A silence at least this long counts as a natural boundary. */
  pauseMs: number;
  /** Segments repeated at the start of the next chunk for retrieval context. */
  overlapSegments: number;
};

export const DEFAULT_TRANSCRIPT_CHUNKING: TranscriptChunkOptions = {
  targetTokens: 320,
  maxTokens: 520,
  pauseMs: 1500,
  overlapSegments: 1,
};

/**
 * Groups timed segments into retrieval chunks. Segments are never split, so
 * every chunk maps to an exact [startMs, endMs] range and segment span for
 * citations. Boundaries prefer, in order: speaker changes, long pauses, and
 * sentence ends once the target size is reached.
 */
export function chunkTranscript(
  segments: TranscriptSegmentInput[],
  options: Partial<TranscriptChunkOptions> = {},
): TranscriptChunk[] {
  const opts = { ...DEFAULT_TRANSCRIPT_CHUNKING, ...options };
  const segs = [...segments].filter((s) => s.text.trim()).sort((a, b) => a.startMs - b.startMs);
  const chunks: TranscriptChunk[] = [];
  const multiSpeaker = new Set(segs.map((s) => s.speaker).filter(Boolean)).size > 1;

  let current: TranscriptSegmentInput[] = [];
  let tokens = 0;
  // Segments in `current` that were not carried over as overlap.
  let fresh = 0;

  const flush = () => {
    if (fresh === 0) return;
    chunks.push(build(current, multiSpeaker));
    const overlap = opts.overlapSegments > 0 ? current.slice(-opts.overlapSegments) : [];
    const overlapTokens = overlap.reduce((n, s) => n + estimateTokens(s.text), 0);
    // Do not carry overlap if it alone would fill most of the next chunk.
    const carry = overlapTokens < opts.targetTokens / 2;
    current = carry ? overlap : [];
    tokens = carry ? overlapTokens : 0;
    fresh = 0;
  };

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const segTokens = estimateTokens(seg.text);
    if (fresh > 0 && tokens + segTokens > opts.maxTokens) flush();

    current.push(seg);
    tokens += segTokens;
    fresh++;

    const next = segs[i + 1];
    if (!next) break;
    if (tokens < opts.targetTokens) continue;

    const speakerChange = seg.speaker !== next.speaker;
    const pause = next.startMs - seg.endMs >= opts.pauseMs;
    const sentenceEnd = /[.!?]["')\]]?$/.test(seg.text.trim());
    if (speakerChange || pause || sentenceEnd) flush();
  }
  flush();
  return chunks;
}

function build(segs: TranscriptSegmentInput[], labelSpeakers: boolean): TranscriptChunk {
  const lines: string[] = [];
  let prevSpeaker: string | null | undefined;
  for (const s of segs) {
    const text = s.text.trim();
    if (labelSpeakers && s.speaker && s.speaker !== prevSpeaker) lines.push(`[${s.speaker}] ${text}`);
    else lines.push(text);
    prevSpeaker = s.speaker;
  }
  const text = lines.join(" ");
  return {
    firstSegment: segs[0]!.index,
    lastSegment: segs.at(-1)!.index,
    startMs: segs[0]!.startMs,
    endMs: Math.max(...segs.map((s) => s.endMs)),
    text,
    tokenCount: estimateTokens(text),
    speakers: [...new Set(segs.map((s) => s.speaker).filter((s): s is string => Boolean(s)))],
  };
}
