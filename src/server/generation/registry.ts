import type { GenerationJob, JobType, LogLevel, Prisma } from "@prisma/client";
import type { ChatModel, Usage } from "@/server/ai";

/**
 * Artifact generators, keyed by job type. Each registers itself in
 * src/server/generation/index.ts. A generator returns its summary and token
 * usage; the runner (run.ts) owns job status, retries and failure handling.
 */
export type GenerationContext = {
  model: ChatModel;
  /** Overall progress 0..1 with an optional user-visible message. */
  progress(fraction: number, message?: string): Promise<void>;
  log(level: LogLevel, message: string, data?: Prisma.InputJsonValue): Promise<void>;
};

export type GenerationResult = {
  result: Prisma.InputJsonValue;
  usage: Usage;
  model: string;
  provider: string;
  promptVersion: string;
};

export type Generator = (job: GenerationJob, ctx: GenerationContext) => Promise<GenerationResult>;

const generators = new Map<JobType, Generator>();

export function registerGenerator(type: JobType, fn: Generator): void {
  generators.set(type, fn);
}

export function hasGenerator(type: JobType): boolean {
  return generators.has(type);
}

export function getGenerator(type: JobType): Generator | undefined {
  return generators.get(type);
}
