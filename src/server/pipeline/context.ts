import type { GenerationJob, LogLevel, Prisma, ProcessingStage, Source, SourceAsset, StudySet } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type IngestContext = {
  job: GenerationJob;
  source: Source & { assets: SourceAsset[] };
  studySet: StudySet;
  workDir: string;
  /** Object-storage prefix for this source's files. */
  storagePrefix: string;
  /** Enter a stage; progress jumps to the start of that stage's band. */
  enter(stage: ProcessingStage, message?: string): Promise<void>;
  /** Progress within the current stage, 0..1. Throttled DB writes. */
  progress(fraction: number): Promise<void>;
  log(level: LogLevel, message: string, data?: Prisma.InputJsonValue): Promise<void>;
};

/**
 * Builds a context whose overall progress is divided evenly across the
 * planned stages, so the UI can show a monotonic bar plus a named stage.
 */
export function createContext(
  base: Omit<IngestContext, "enter" | "progress" | "log">,
  plan: ProcessingStage[],
): IngestContext {
  let current: ProcessingStage | null = null;
  let lastWrite = 0;
  const band = (stage: ProcessingStage): [number, number] => {
    const i = Math.max(0, plan.indexOf(stage));
    return [i / plan.length, (i + 1) / plan.length];
  };
  const jobLog = logger.child({ jobId: base.job.id, sourceId: base.source.id });

  const ctx: IngestContext = {
    ...base,
    async enter(stage, message) {
      current = stage;
      const [start] = band(stage);
      await db.generationJob.update({ where: { id: base.job.id }, data: { stage, progress: start } });
      await ctx.log("INFO", message ?? STAGE_MESSAGES[stage]);
    },
    async progress(fraction) {
      if (!current) return;
      const now = Date.now();
      if (now - lastWrite < 1500 && fraction < 1) return;
      lastWrite = now;
      const [start, end] = band(current);
      const value = start + (end - start) * Math.min(1, Math.max(0, fraction));
      await db.generationJob.update({ where: { id: base.job.id }, data: { progress: value } });
    },
    async log(level, message, data) {
      jobLog[level === "ERROR" ? "error" : level === "WARN" ? "warn" : level === "DEBUG" ? "debug" : "info"]({ stage: current, data }, message);
      await db.jobEvent.create({ data: { jobId: base.job.id, level, stage: current, message, data } });
    },
  };
  return ctx;
}

const STAGE_MESSAGES: Record<ProcessingStage, string> = {
  UPLOADING: "Fetching media",
  SCANNING: "Checking file safety",
  EXTRACTING_AUDIO: "Extracting audio",
  TRANSCRIBING: "Transcribing",
  PARSING_DOCUMENT: "Parsing document",
  OCR: "Recognising text in images",
  SEGMENTING: "Segmenting content",
  INDEXING: "Indexing for search",
  GENERATING: "Generating learning materials",
  VALIDATING: "Validating citations",
  COMPLETE: "Done",
};
