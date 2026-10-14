import { db } from "@/lib/db";
import { createAndEnqueueJob } from "@/server/services/jobs";
import { keys } from "@/lib/storage";
import { createContext } from "./context";
import { indexChunks } from "./stages/index-chunks";
import { segmentTranscript } from "./stages/transcribe";

/** Seconds to wait after the last transcript edit before rebuilding, so a burst of edits costs one run. */
export const REINDEX_DELAY_MS = 20_000;

/**
 * Queues a rebuild of a source's chunks and embeddings unless one is already
 * waiting. Called after transcript corrections and by the reindex script.
 */
export async function scheduleReindex(sourceId: string, studySetId: string, userId: string, delayMs = REINDEX_DELAY_MS): Promise<string | null> {
  const pending = await db.generationJob.findFirst({
    where: { sourceId, type: "REINDEX_SOURCE", status: "QUEUED" },
    select: { id: true },
  });
  if (pending) return null;
  return createAndEnqueueJob({ type: "REINDEX_SOURCE", studySetId, userId, sourceId, stage: "SEGMENTING", delayMs });
}

/**
 * Rebuilds chunks from the current (possibly corrected) transcript, leaving out
 * segments the student marked inaccurate, then re-embeds every chunk of the
 * source. Document sources keep their chunks and are only re-embedded.
 * The source stays READY throughout; existing citations keep their copied
 * locations even though chunk ids change.
 */
export async function runReindexJob(jobId: string): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job?.sourceId || job.status === "SUCCEEDED" || job.status === "CANCELLED") return;
  const [source, studySet] = await Promise.all([
    db.source.findUnique({ where: { id: job.sourceId }, include: { assets: true, transcript: true } }),
    db.studySet.findUnique({ where: { id: job.studySetId } }),
  ]);
  if (!source || !studySet || studySet.deletedAt || source.status !== "READY") {
    await db.generationJob.update({ where: { id: jobId }, data: { status: "CANCELLED", finishedAt: new Date() } });
    return;
  }
  await db.generationJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } } });

  const ctx = createContext(
    { job, source, studySet, workDir: "", storagePrefix: keys.sourcePrefix(studySet.workspaceId, studySet.id, source.id) },
    ["SEGMENTING", "INDEXING"],
  );

  if (source.transcript) {
    await ctx.enter("SEGMENTING", "Rebuilding passages from the corrected transcript");
    const segments = await db.transcriptSegment.findMany({
      where: { transcriptId: source.transcript.id },
      orderBy: { index: "asc" },
      select: { index: true, startMs: true, endMs: true, speaker: true, text: true, flaggedInaccurate: true },
    });
    const usable = segments.filter((s) => !s.flaggedInaccurate);
    const excluded = segments.length - usable.length;
    await segmentTranscript(ctx, usable);
    if (excluded) await ctx.log("WARN", `${excluded} line(s) marked inaccurate are excluded from search and generation.`);
  }

  await ctx.enter("INDEXING");
  await indexChunks(ctx);
  await db.generationJob.update({ where: { id: jobId }, data: { status: "SUCCEEDED", stage: "COMPLETE", progress: 1, finishedAt: new Date() } });
}

export async function recordReindexFailure(jobId: string, err: unknown, willRetry: boolean): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: willRetry ? "QUEUED" : "FAILED",
      error: "Search index update failed.",
      finishedAt: willRetry ? null : new Date(),
      events: { create: { level: willRetry ? "WARN" : "ERROR", message: "Search index update failed.", data: { detail: message.slice(0, 2000) } } },
    },
  });
}
