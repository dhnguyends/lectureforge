import type { GenerationJob, JobType } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { AiError, getChatModel, type ChatModel } from "@/server/ai";
import { PipelineError } from "@/server/pipeline/errors";
import { getGenerator, type GenerationContext } from "./registry";
import "./index";

export { isAiConfigured } from "@/server/ai";

function createContext(job: GenerationJob, model: ChatModel): GenerationContext {
  let lastWrite = 0;
  return {
    model,
    async progress(fraction, message) {
      const now = Date.now();
      if (message || now - lastWrite > 1500 || fraction >= 1) {
        lastWrite = now;
        await db.generationJob.update({ where: { id: job.id }, data: { progress: Math.min(1, Math.max(0, fraction)) } });
      }
      if (message) await db.jobEvent.create({ data: { jobId: job.id, stage: "GENERATING", message } });
    },
    async log(level, message, data) {
      await db.jobEvent.create({ data: { jobId: job.id, level, stage: "VALIDATING", message, data } });
    },
  };
}

/** Runs one generation job. `model` is injectable for tests. */
export async function runGenerationJob(jobId: string, model: ChatModel = getChatModel()): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status === "SUCCEEDED" || job.status === "CANCELLED") return;
  const generator = getGenerator(job.type);
  if (!generator) throw new PipelineError("This generator is not available yet.");

  await db.generationJob.update({
    where: { id: job.id },
    data: { status: "RUNNING", stage: "GENERATING", startedAt: job.startedAt ?? new Date(), attempts: { increment: 1 }, error: null },
  });
  const out = await generator(job, createContext(job, model));
  await db.generationJob.update({
    where: { id: job.id },
    data: {
      status: "SUCCEEDED",
      stage: "COMPLETE",
      progress: 1,
      finishedAt: new Date(),
      result: out.result,
      provider: out.provider,
      model: out.model,
      promptVersion: out.promptVersion,
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
    },
  });
  logger.info({ jobId, type: job.type, usage: out.usage, model: out.model }, "generation complete");
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof AiError) return err.retryable;
  if (err instanceof PipelineError) return err.retryable;
  return true;
}

export function userMessageOf(err: unknown): string {
  if (err instanceof AiError) return err.userMessage;
  if (err instanceof PipelineError) return err.userMessage;
  return "Generation failed unexpectedly.";
}

const GUIDE_TYPES: JobType[] = ["GENERATE_STUDY_GUIDE"];

export async function recordGenerationFailure(jobId: string, err: unknown, willRetry: boolean): Promise<void> {
  const message = userMessageOf(err);
  const job = await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: willRetry ? "QUEUED" : "FAILED",
      error: message,
      finishedAt: willRetry ? null : new Date(),
      events: {
        create: {
          level: willRetry ? "WARN" : "ERROR",
          message: willRetry ? `${message} Retrying…` : message,
          data: { detail: (err instanceof Error ? err.message : String(err)).slice(0, 2000) },
        },
      },
    },
  });
  if (!willRetry && GUIDE_TYPES.includes(job.type)) {
    await db.studyGuide.updateMany({ where: { generationJobId: jobId }, data: { status: "FAILED" } });
  }
}
