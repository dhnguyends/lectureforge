import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { deletePrefix } from "@/lib/storage";

type PurgePayload = { prefix: string; sourceId?: string };

/**
 * Permanent deletion of stored objects (and, for study sets, the database
 * rows). The GenerationJob for a study-set purge is itself deleted by the
 * cascade, so completion is recorded in the audit log instead.
 */
export async function runPurgeJob(jobId: string): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const payload = job.payload as PurgePayload | null;
  if (!payload?.prefix) throw new Error(`Purge job ${jobId} has no prefix`);

  const removed = await deletePrefix(payload.prefix);

  if (job.type === "PURGE_STUDY_SET") {
    await db.studySet.delete({ where: { id: job.studySetId } }).catch((err: { code?: string }) => {
      if (err.code !== "P2025") throw err; // already gone
    });
    await db.auditLog.create({
      data: {
        userId: job.userId,
        action: "study_set.purged",
        entityType: "StudySet",
        entityId: job.studySetId,
        metadata: { objectsRemoved: removed },
      },
    });
  } else {
    await db.generationJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", finishedAt: new Date(), result: { objectsRemoved: removed } },
    });
  }
  logger.info({ jobId, type: job.type, removed }, "purge complete");
}
