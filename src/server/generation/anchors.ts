import type { Prisma } from "@prisma/client";
import { locateInLines, locateInSegments, type BoxedLine } from "@/lib/citations/verify";
import { db } from "@/lib/db";
import type { VerifiedCitation } from "./study-guide/validate";

type AnchorOwner = { studyGuideSectionId: string } | { flashcardId: string } | { quizQuestionId: string } | { exerciseId: string };

/**
 * Turns verified citations into CitationAnchor rows. Each anchor copies the
 * precise location (narrowed to the transcript segments the excerpt spans, or
 * the page and region of a document chunk), so it keeps resolving even if
 * the source is later re-processed.
 */
export async function buildAnchors(
  citations: { claimKey: string; citation: VerifiedCitation }[],
  owner: AnchorOwner,
): Promise<Prisma.CitationAnchorCreateManyInput[]> {
  if (!citations.length) return [];
  const chunkIds = [...new Set(citations.map((c) => c.citation.chunkId))];
  const chunks = await db.extractedChunk.findMany({
    where: { id: { in: chunkIds } },
    select: { id: true, sourceId: true, kind: true, startMs: true, endMs: true, pageStart: true, regions: true, metadata: true },
  });
  const byId = new Map(chunks.map((c) => [c.id, c]));

  // Transcript segments for every transcript chunk, fetched once.
  const segmentRanges = chunks.flatMap((c) => {
    const m = c.metadata as { firstSegment?: number; lastSegment?: number } | null;
    return c.kind === "TRANSCRIPT" && m?.firstSegment !== undefined && m.lastSegment !== undefined
      ? [{ chunkId: c.id, sourceId: c.sourceId, first: m.firstSegment, last: m.lastSegment }]
      : [];
  });
  const segments = segmentRanges.length
    ? await db.transcriptSegment.findMany({
        where: {
          OR: segmentRanges.map((r) => ({
            transcript: { sourceId: r.sourceId },
            index: { gte: r.first, lte: r.last },
          })),
        },
        select: { id: true, index: true, startMs: true, endMs: true, text: true, transcript: { select: { sourceId: true } } },
      })
    : [];

  const rows: Prisma.CitationAnchorCreateManyInput[] = [];
  for (const { claimKey, citation } of citations) {
    const chunk = byId.get(citation.chunkId);
    if (!chunk) continue;
    const base = { sourceId: chunk.sourceId, chunkId: chunk.id, excerpt: citation.excerpt.slice(0, 500), verified: true, claimKey, ...owner };

    if (chunk.kind === "TRANSCRIPT") {
      const range = segmentRanges.find((r) => r.chunkId === chunk.id);
      const candidates = range
        ? segments.filter((s) => s.transcript.sourceId === chunk.sourceId && s.index >= range.first && s.index <= range.last)
        : [];
      const hit = locateInSegments(citation.excerpt, candidates);
      rows.push({
        ...base,
        transcriptSegmentId: hit?.first.id ?? null,
        startMs: hit?.startMs ?? chunk.startMs,
        endMs: hit?.endMs ?? chunk.endMs,
      });
    } else {
      const regions = (chunk.regions as Prisma.JsonArray | null) ?? [];
      const lines = (chunk.metadata as { lines?: BoxedLine[] } | null)?.lines;
      const precise = lines ? locateInLines(citation.excerpt, lines) : null;
      rows.push({
        ...base,
        page: chunk.pageStart,
        region: precise ? { page: chunk.pageStart, bbox: precise } : ((regions[0] as Prisma.InputJsonValue | undefined) ?? undefined),
      });
    }
  }
  return rows;
}
