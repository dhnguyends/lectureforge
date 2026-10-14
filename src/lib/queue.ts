import { Queue, type JobsOptions } from "bullmq";
import { createRedis } from "./redis";

/**
 * Queue topology
 * - ingest:      per-source media/document processing (CPU + network heavy)
 * - generation:  AI artifact generation (rate-limited by provider quotas)
 * - maintenance: purges and exports
 *
 * Every BullMQ job carries only a GenerationJob id. The database row is the
 * source of truth for status, stage and progress; BullMQ only schedules work.
 */
export const QUEUES = {
  ingest: "ingest",
  generation: "generation",
  maintenance: "maintenance",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type JobData = { generationJobId: string };

const DEFAULT_OPTS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 15_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

const globalForQueues = globalThis as unknown as { queues?: Map<QueueName, Queue<JobData>> };

export function getQueue(name: QueueName): Queue<JobData> {
  globalForQueues.queues ??= new Map();
  let q = globalForQueues.queues.get(name);
  if (!q) {
    q = new Queue<JobData>(name, { connection: createRedis(), defaultJobOptions: DEFAULT_OPTS });
    globalForQueues.queues.set(name, q);
  }
  return q;
}

/** Uses the GenerationJob id as the BullMQ job id so enqueueing is idempotent. */
export async function enqueue(name: QueueName, generationJobId: string, opts: JobsOptions = {}): Promise<void> {
  await getQueue(name).add(name, { generationJobId }, { jobId: generationJobId, ...opts });
}
