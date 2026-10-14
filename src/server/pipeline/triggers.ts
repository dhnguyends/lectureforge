import type { JobType, OutputType } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createAndEnqueueJob } from "@/server/services/jobs";
import { hasGenerator } from "@/server/generation";
import { isAiConfigured } from "@/server/generation/run";

const JOB_FOR_OUTPUT: Partial<Record<OutputType, JobType>> = {
  STUDY_GUIDE: "GENERATE_STUDY_GUIDE",
  FLASHCARDS: "GENERATE_FLASHCARDS",
  QUIZ: "GENERATE_QUIZ",
  EXERCISES: "GENERATE_EXERCISES",
  AUDIO_RECAP: "GENERATE_AUDIO_RECAP",
};

/**
 * Called after each source becomes READY. Once every source in the set has
 * settled (ready or failed) and at least one is ready, queue the learning
 * materials the user asked for at creation time — once per output type.
 */
export async function onSourceReady(studySetId: string, userId: string): Promise<void> {
  const [set, pending, ready] = await Promise.all([
    db.studySet.findUnique({ where: { id: studySetId }, select: { outputTypes: true, deletedAt: true } }),
    db.source.count({ where: { studySetId, status: { in: ["PENDING_UPLOAD", "UPLOADED", "PROCESSING"] } } }),
    db.source.count({ where: { studySetId, status: "READY" } }),
  ]);
  if (!set || set.deletedAt || pending > 0 || ready === 0) return;
  if (!isAiConfigured()) {
    logger.info({ studySetId }, "AI provider not configured; skipping auto-generation");
    return;
  }

  for (const output of set.outputTypes) {
    const type = JOB_FOR_OUTPUT[output];
    if (!type) continue; // TUTOR needs no pre-generation
    if (!hasGenerator(type)) {
      logger.info({ studySetId, type }, "generator not available yet; skipping auto-generation");
      continue;
    }
    const existing = await db.generationJob.count({ where: { studySetId, type } });
    if (existing > 0) continue;
    await createAndEnqueueJob({ type, studySetId, userId, stage: "GENERATING" });
  }
}
