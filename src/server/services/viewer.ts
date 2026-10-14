import type { Prisma, Source, SourceAsset } from "@prisma/client";
import { toWebVtt } from "@/lib/captions";
import type { AnnotationView, MediaView, SearchResultView, SegmentView, SourceCitationView, TranscriptView } from "@/lib/contracts/viewer";
import { db } from "@/lib/db";
import { badRequest, forbidden, notFound } from "@/lib/errors";
import { makeSnippet, sourceHref } from "@/lib/source-links";
import { createDownloadUrl } from "@/lib/storage";
import { scheduleReindex } from "@/server/pipeline/reindex";
import { retrieveRanked } from "@/server/retrieval";

const MEDIA_TTL_SECONDS = 60 * 60;

/** Containers every major browser can play natively. */
const BROWSER_PLAYABLE = new Set(["video/mp4", "video/webm", "audio/mpeg", "audio/mp4", "audio/x-m4a", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/flac"]);

function asset(source: Source & { assets: SourceAsset[] }, role: SourceAsset["role"]) {
  return source.assets.find((a) => a.role === role);
}

export async function getMedia(source: Source & { assets: SourceAsset[] }): Promise<MediaView> {
  const original = asset(source, "ORIGINAL");
  const audio = asset(source, "AUDIO_EXTRACT");
  let file: SourceAsset | undefined;
  let fallback: SourceAsset | undefined;

  switch (source.kind) {
    case "VIDEO":
    case "AUDIO":
      file = original && BROWSER_PLAYABLE.has(original.mimeType) ? original : (audio ?? original);
      fallback = file === original ? audio : undefined;
      break;
    case "SLIDES":
    case "DOCUMENT":
      file = asset(source, "NORMALIZED_PDF");
      break;
    case "YOUTUBE":
      file = undefined;
      break;
    default:
      file = original;
  }
  const sign = (a?: SourceAsset) => (a ? createDownloadUrl(a.storageKey, MEDIA_TTL_SECONDS) : Promise.resolve(null));
  const [url, audioFallbackUrl] = await Promise.all([sign(file), sign(fallback)]);
  return {
    sourceId: source.id,
    kind: source.kind,
    title: source.title,
    url,
    mimeType: file?.mimeType ?? null,
    audioFallbackUrl,
    youtubeId: source.kind === "YOUTUBE" ? source.externalId : null,
    durationMs: source.durationMs,
    pageCount: source.pageCount,
    expiresAt: new Date(Date.now() + MEDIA_TTL_SECONDS * 1000).toISOString(),
  };
}

function segmentView(s: {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
  originalText: string;
  flaggedInaccurate: boolean;
  flagNote: string | null;
}): SegmentView {
  return {
    id: s.id,
    index: s.index,
    startMs: s.startMs,
    endMs: s.endMs,
    speaker: s.speaker,
    text: s.text,
    edited: s.text !== s.originalText,
    originalText: s.originalText,
    flaggedInaccurate: s.flaggedInaccurate,
    flagNote: s.flagNote,
  };
}

export async function getTranscript(sourceId: string): Promise<TranscriptView | null> {
  const t = await db.transcript.findUnique({
    where: { sourceId },
    include: { segments: { orderBy: { index: "asc" } } },
  });
  if (!t) return null;
  return { language: t.language, provider: t.provider, diarized: t.diarized, segments: t.segments.map(segmentView) };
}

export async function getCaptions(sourceId: string): Promise<string> {
  const t = await db.transcript.findUnique({ where: { sourceId }, include: { segments: { orderBy: { index: "asc" } } } });
  if (!t) throw notFound("Transcript");
  return toWebVtt(t.segments);
}

/**
 * Corrects or flags one transcript line. The provider's original wording is
 * kept, edits are reversible, and the source's search index is rebuilt shortly
 * after (debounced) so future generation uses the corrected text.
 */
export async function patchSegment(
  userId: string,
  segmentId: string,
  input: { text?: string; revert?: true; flaggedInaccurate?: boolean; flagNote?: string | null },
): Promise<SegmentView> {
  const seg = await db.transcriptSegment.findUnique({ where: { id: segmentId }, include: { transcript: { select: { sourceId: true } } } });
  if (!seg) throw notFound("Transcript line");
  const data: Prisma.TranscriptSegmentUpdateInput = { editedAt: new Date() };
  if (input.revert) data.text = seg.originalText;
  else if (input.text !== undefined) data.text = input.text;
  if (input.flaggedInaccurate !== undefined) {
    data.flaggedInaccurate = input.flaggedInaccurate;
    data.flagNote = input.flaggedInaccurate ? (input.flagNote ?? seg.flagNote) : null;
  } else if (input.flagNote !== undefined) {
    if (!seg.flaggedInaccurate) throw badRequest("Mark the line as inaccurate before adding a note.");
    data.flagNote = input.flagNote;
  }
  const updated = await db.transcriptSegment.update({ where: { id: segmentId }, data });
  const source = await db.source.findUniqueOrThrow({ where: { id: seg.transcript.sourceId }, select: { id: true, studySetId: true } });
  await scheduleReindex(source.id, source.studySetId, userId);
  return segmentView(updated);
}

/** The caller's private annotations on one source. */
export async function listAnnotations(userId: string, sourceId: string): Promise<AnnotationView[]> {
  const rows = await db.annotation.findMany({ where: { userId, sourceId }, orderBy: { createdAt: "asc" } });
  return rows.map(annotationView);
}

function annotationView(a: {
  id: string;
  kind: "HIGHLIGHT" | "NOTE";
  transcriptSegmentId: string | null;
  page: number | null;
  region: Prisma.JsonValue;
  body: string | null;
  color: string | null;
  createdAt: Date;
}): AnnotationView {
  return {
    id: a.id,
    kind: a.kind,
    transcriptSegmentId: a.transcriptSegmentId,
    page: a.page,
    region: a.region,
    body: a.body,
    color: a.color,
    createdAt: a.createdAt.toISOString(),
  };
}

export async function createAnnotation(
  userId: string,
  sourceId: string,
  input: { kind: "HIGHLIGHT" | "NOTE"; transcriptSegmentId?: string; page?: number; region?: { bbox: number[] }; body?: string; color?: string },
): Promise<AnnotationView> {
  if (input.transcriptSegmentId) {
    const ok = await db.transcriptSegment.count({ where: { id: input.transcriptSegmentId, transcript: { sourceId } } });
    if (!ok) throw badRequest("That transcript line does not belong to this source.");
  }
  const row = await db.annotation.create({
    data: {
      userId,
      sourceId,
      kind: input.kind,
      transcriptSegmentId: input.transcriptSegmentId,
      page: input.page,
      region: input.region,
      body: input.body,
      color: input.color ?? "yellow",
    },
  });
  return annotationView(row);
}

/** Annotations are private: only their author may read, change or delete them. */
export async function requireOwnAnnotation(userId: string, annotationId: string) {
  const row = await db.annotation.findUnique({ where: { id: annotationId } }).catch(() => null);
  if (!row) throw notFound("Note");
  if (row.userId !== userId) throw forbidden();
  return row;
}

export async function updateAnnotation(id: string, input: { body?: string; color?: string }): Promise<AnnotationView> {
  return annotationView(await db.annotation.update({ where: { id }, data: input }));
}

export async function deleteAnnotation(id: string): Promise<void> {
  await db.annotation.delete({ where: { id } });
}

/** Statements in the study set's guides that cite this source, newest guide first. */
export async function citationsForSource(sourceId: string): Promise<SourceCitationView[]> {
  const anchors = await db.citationAnchor.findMany({
    where: { sourceId, studyGuideSectionId: { not: null } },
    include: { studyGuideSection: { select: { id: true, title: true, guideId: true } } },
    orderBy: [{ startMs: "asc" }, { page: "asc" }],
    take: 500,
  });
  return anchors.map((a) => ({
    anchorId: a.id,
    startMs: a.startMs,
    endMs: a.endMs,
    page: a.page,
    region: a.region,
    excerpt: a.excerpt,
    claimKey: a.claimKey,
    sectionId: a.studyGuideSection!.id,
    sectionTitle: a.studyGuideSection!.title,
    guideId: a.studyGuideSection!.guideId,
  }));
}

/** Hybrid search across every source in a study set. */
export async function searchStudySet(studySetId: string, query: string): Promise<SearchResultView[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const ranked = await retrieveRanked(studySetId, q, 20);
  return ranked
    // With embeddings, results must be semantically close (a lone keyword hit on an
    // unrelated passage is noise); without them, keyword hits are all we have.
    .filter((c) => (c.similarity === null ? c.keywordMatch : c.similarity >= 0.33 || (c.keywordMatch && c.similarity >= 0.2)))
    .map((c) => ({
      chunkId: c.id,
      sourceId: c.sourceId,
      sourceTitle: c.sourceTitle,
      sourceKind: c.sourceKind,
      startMs: c.startMs,
      page: c.pageStart,
      headingPath: c.headingPath,
      snippet: makeSnippet(c.text, q),
      match: c.keywordMatch && c.similarity !== null ? "both" : c.keywordMatch ? "keyword" : "semantic",
      href: sourceHref(studySetId, c.sourceId, { startMs: c.startMs, page: c.pageStart }),
    }));
}
