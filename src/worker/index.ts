import "dotenv/config";
import { UnrecoverableError, Worker, type Job } from "bullmq";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger as baseLogger } from "@/lib/logger";
import { QUEUES, enqueue, type JobData } from "@/lib/queue";
import { createRedis } from "@/lib/redis";
import { isRetryable, recordGenerationFailure, runGenerationJob } from "@/server/generation/run";
import { PipelineError } from "@/server/pipeline/errors";
import { runPurgeJob } from "@/server/pipeline/purge";
import { recordReindexFailure, runReindexJob } from "@/server/pipeline/reindex";
import { recordIngestFailure, runIngestJob } from "@/server/pipeline/run-ingest";
import { queueFor } from "@/server/services/jobs";

/**
 * Background worker. Runs outside Next.js (long-lived process with ffmpeg,
 * LibreOffice, Tesseract available), e.g. on Fly.io, Railway, ECS or a VM.
 */
const logger = baseLogger.child({ component: "worker" });

function willRetry(job: Job<JobData>, err: unknown): boolean {
  const retryable = err instanceof PipelineError ? err.retryable : true;
  return retryable && job.attemptsMade + 1 < (job.opts.attempts ?? 1);
}

async function ingestProcessor(job: Job<JobData>): Promise<void> {
  const { generationJobId } = job.data;
  const record = await db.generationJob.findUnique({ where: { id: generationJobId }, select: { type: true } });
  const reindex = record?.type === "REINDEX_SOURCE";
  try {
    await (reindex ? runReindexJob(generationJobId) : runIngestJob(generationJobId));
  } catch (err) {
    const retry = willRetry(job, err);
    logger.error({ err, generationJobId, attempt: job.attemptsMade + 1, retry }, reindex ? "reindex failed" : "ingest failed");
    await (reindex ? recordReindexFailure(generationJobId, err, retry) : recordIngestFailure(generationJobId, err, retry));
    // UnrecoverableError tells BullMQ not to spend remaining attempts.
    throw retry ? err : new UnrecoverableError(err instanceof Error ? err.message : String(err));
  }
}

async function generationProcessor(job: Job<JobData>): Promise<void> {
  const { generationJobId } = job.data;
  try {
    await runGenerationJob(generationJobId);
  } catch (err) {
    const retry = isRetryable(err) && job.attemptsMade + 1 < (job.opts.attempts ?? 1);
    logger.error({ err, generationJobId, attempt: job.attemptsMade + 1, retry }, "generation failed");
    await recordGenerationFailure(generationJobId, err, retry);
    throw retry ? err : new UnrecoverableError(err instanceof Error ? err.message : String(err));
  }
}

async function maintenanceProcessor(job: Job<JobData>): Promise<void> {
  await runPurgeJob(job.data.generationJobId);
}

/**
 * Re-enqueue jobs that were committed to the database but never reached
 * Redis (e.g. Redis was briefly down when the API created them), or that were
 * RUNNING when a previous worker crashed. Enqueue is idempotent by job id.
 */
async function sweepOrphans(): Promise<void> {
  const stale = new Date(Date.now() - 60_000);
  const jobs = await db.generationJob.findMany({
    where: {
      OR: [
        { status: "QUEUED", queuedAt: { lt: stale } },
        { status: "RUNNING", startedAt: { lt: new Date(Date.now() - 2 * 3600_000) } },
      ],
    },
    select: { id: true, type: true },
    take: 500,
  });
  for (const j of jobs) await enqueue(queueFor(j.type), j.id);
  if (jobs.length) logger.info({ count: jobs.length }, "re-enqueued orphaned jobs");
}

async function main() {
  const e = env();
  const workers = [
    new Worker<JobData>(QUEUES.ingest, ingestProcessor, {
      connection: createRedis(),
      concurrency: e.INGEST_CONCURRENCY,
      // Media jobs can legitimately run for a long time.
      lockDuration: 5 * 60_000,
    }),
    new Worker<JobData>(QUEUES.generation, generationProcessor, { connection: createRedis(), concurrency: 4 }),
    new Worker<JobData>(QUEUES.maintenance, maintenanceProcessor, { connection: createRedis(), concurrency: 2 }),
  ];
  for (const w of workers) {
    w.on("failed", (job, err) => logger.warn({ queue: w.name, jobId: job?.id, err: err.message }, "job failed"));
    w.on("error", (err) => logger.error({ queue: w.name, err }, "worker error"));
  }

  await sweepOrphans();
  const sweep = setInterval(() => sweepOrphans().catch((err) => logger.error({ err }, "sweep failed")), 5 * 60_000);
  logger.info({ queues: workers.map((w) => w.name), concurrency: e.INGEST_CONCURRENCY }, "worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down; finishing active jobs");
    clearInterval(sweep);
    await Promise.all(workers.map((w) => w.close()));
    await db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
