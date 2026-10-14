import type { JobType, Prisma, ProcessingStage } from "@prisma/client";
import { db } from "@/lib/db";
import { enqueue, QUEUES, type QueueName } from "@/lib/queue";

const QUEUE_FOR: Record<JobType, QueueName> = {
  SOURCE_INGEST: QUEUES.ingest,
  GENERATE_STUDY_GUIDE: QUEUES.generation,
  GENERATE_FLASHCARDS: QUEUES.generation,
  GENERATE_QUIZ: QUEUES.generation,
  GENERATE_EXERCISES: QUEUES.generation,
  GENERATE_AUDIO_RECAP: QUEUES.generation,
  REGENERATE_ITEM: QUEUES.generation,
  VALIDATE_ARTIFACT: QUEUES.generation,
  PURGE_STUDY_SET: QUEUES.maintenance,
  PURGE_SOURCE: QUEUES.maintenance,
  REINDEX_SOURCE: QUEUES.ingest,
};

/**
 * Creates the GenerationJob row first, then schedules it. If Redis is down the
 * row stays QUEUED and the worker's startup sweep re-enqueues it, so no job is
 * lost between the two writes.
 */
export async function createAndEnqueueJob(input: {
  type: JobType;
  studySetId: string;
  userId: string;
  sourceId?: string;
  stage?: ProcessingStage;
  payload?: Prisma.InputJsonValue;
  /** Delay before the worker may start the job (debouncing). */
  delayMs?: number;
  /** Initial result/checkpoint, e.g. finished transcription parts carried over from a failed attempt. */
  result?: Prisma.InputJsonValue;
}): Promise<string> {
  const job = await db.generationJob.create({
    data: {
      type: input.type,
      studySetId: input.studySetId,
      userId: input.userId,
      sourceId: input.sourceId,
      stage: input.stage,
      payload: input.payload,
      result: input.result,
      events: { create: { message: "Queued", stage: input.stage } },
    },
    select: { id: true },
  });
  await enqueue(QUEUE_FOR[input.type], job.id, input.delayMs ? { delay: input.delayMs } : {});
  return job.id;
}

export function queueFor(type: JobType): QueueName {
  return QUEUE_FOR[type];
}
