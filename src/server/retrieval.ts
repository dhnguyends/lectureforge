import type { ChunkKind, SourceKind } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getEmbeddingProvider } from "@/server/providers/embeddings";

export type RetrievedChunk = {
  id: string;
  sourceId: string;
  sourceKind: SourceKind;
  sourceTitle: string;
  kind: ChunkKind;
  index: number;
  text: string;
  tokenCount: number;
  startMs: number | null;
  endMs: number | null;
  pageStart: number | null;
  headingPath: string[];
  score: number;
};

/**
 * Builds an OR tsquery from free text. Terms are reduced to letters/digits so
 * user input can never inject tsquery syntax.
 */
export function buildOrTsQuery(text: string): string | null {
  const terms = [...new Set((text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []).filter((t) => !STOPWORDS.has(t)))].slice(0, 32);
  return terms.length ? terms.join(" | ") : null;
}

const STOPWORDS = new Set(
  "of is in to on at by an as be or it we do if so no up the and for are but not you all any can had her was one our out has his how its may new now see two way who did get him let say she too use with that this from they will what when your which their there been have into than then them these some only also more most such over each just like does why where explain".split(
    " ",
  ),
);

/**
 * Reciprocal rank fusion: merges ranked lists without needing comparable
 * scores. k=60 is the standard constant from the original paper.
 */
export function reciprocalRankFusion(lists: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1)));
  }
  return scores;
}

async function keywordSearch(studySetId: string, query: string, limit: number): Promise<string[]> {
  const tsq = buildOrTsQuery(query);
  if (!tsq) return [];
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM "ExtractedChunk" c
    WHERE c."studySetId" = ${studySetId}::uuid
      AND to_tsvector('simple', c.text) @@ to_tsquery('simple', ${tsq})
    ORDER BY ts_rank(to_tsvector('simple', c.text), to_tsquery('simple', ${tsq})) DESC
    LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

async function vectorSearch(studySetId: string, query: string, limit: number): Promise<{ id: string; similarity: number }[]> {
  const provider = getEmbeddingProvider();
  if (!provider) return [];
  try {
    const [vector] = await provider.embed([query], "query");
    const rows = await db.$queryRaw<{ id: string; distance: number }[]>`
      SELECT c.id, (c.embedding <=> ${JSON.stringify(vector)}::vector)::float8 AS distance
      FROM "ExtractedChunk" c
      WHERE c."studySetId" = ${studySetId}::uuid AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${JSON.stringify(vector)}::vector
      LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, similarity: 1 - Number(r.distance) }));
  } catch (err) {
    // Keyword search still works; do not fail generation because of embeddings.
    logger.warn({ err }, "vector search failed; using keyword search only");
    return [];
  }
}

export type RankedChunk = RetrievedChunk & {
  /** Cosine similarity from semantic search, if the chunk was found that way. */
  similarity: number | null;
  keywordMatch: boolean;
};

/**
 * Hybrid retrieval over one study set's chunks: keyword and semantic results
 * fused by rank. Each result says how it matched, so callers (e.g. the tutor)
 * can tell "nothing relevant" apart from "weak matches".
 */
export async function retrieveRanked(studySetId: string, query: string, limit = 8): Promise<RankedChunk[]> {
  const [keyword, vector] = await Promise.all([keywordSearch(studySetId, query, limit * 3), vectorSearch(studySetId, query, limit * 3)]);
  const fused = reciprocalRankFusion([vector.map((v) => v.id), keyword]);
  const ids = [...fused.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
  const sim = new Map(vector.map((v) => [v.id, v.similarity]));
  const kw = new Set(keyword);
  const chunks = await loadChunks(ids);
  return chunks
    .map((c) => ({ ...c, score: fused.get(c.id) ?? 0, similarity: sim.get(c.id) ?? null, keywordMatch: kw.has(c.id) }))
    .sort((a, b) => b.score - a.score);
}

export async function retrieveChunks(studySetId: string, query: string, limit = 8): Promise<RetrievedChunk[]> {
  return retrieveRanked(studySetId, query, limit);
}

export async function loadChunks(ids: string[]): Promise<RetrievedChunk[]> {
  if (!ids.length) return [];
  const rows = await db.extractedChunk.findMany({
    where: { id: { in: ids } },
    include: { source: { select: { kind: true, title: true } } },
  });
  return rows.map(toRetrieved);
}

/** Every chunk in a study set, in reading order (source creation, then chunk index). */
export async function loadAllChunks(studySetId: string): Promise<RetrievedChunk[]> {
  const rows = await db.extractedChunk.findMany({
    where: { studySetId, source: { status: "READY" } },
    include: { source: { select: { kind: true, title: true, createdAt: true } } },
    orderBy: [{ source: { createdAt: "asc" } }, { index: "asc" }],
  });
  return rows.map(toRetrieved);
}

function toRetrieved(c: {
  id: string;
  sourceId: string;
  kind: ChunkKind;
  index: number;
  text: string;
  tokenCount: number;
  startMs: number | null;
  endMs: number | null;
  pageStart: number | null;
  headingPath: string[];
  source: { kind: SourceKind; title: string };
}): RetrievedChunk {
  return {
    id: c.id,
    sourceId: c.sourceId,
    sourceKind: c.source.kind,
    sourceTitle: c.source.title,
    kind: c.kind,
    index: c.index,
    text: c.text,
    tokenCount: c.tokenCount,
    startMs: c.startMs,
    endMs: c.endMs,
    pageStart: c.pageStart,
    headingPath: c.headingPath,
    score: 0,
  };
}
