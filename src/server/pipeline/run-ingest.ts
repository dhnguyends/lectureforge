import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceKind } from "@prisma/client";
import { STAGE_PLANS } from "@/lib/pipeline-plan";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deletePrefix, downloadToFile, keys, safeFilename } from "@/lib/storage";
import { getMalwareScanner } from "@/server/providers/malware";
import { getTranscriptionProvider } from "@/server/providers/transcription";
import { createContext, type IngestContext } from "./context";
import { PipelineError } from "./errors";
import { convertToPdf, ocrImage, ocrPdfPages, parsePdf, readNote, segmentDocument } from "./stages/documents";
import { indexChunks } from "./stages/index-chunks";
import { downloadYouTube, extractAudio, probeMedia, splitAudio } from "./stages/media";
import { segmentTranscript, transcribe } from "./stages/transcribe";
import { onSourceReady } from "./triggers";


/** Download the original upload and run the malware scan on it. */
async function fetchAndScan(ctx: IngestContext): Promise<string> {
  await ctx.enter("SCANNING");
  const original = ctx.source.assets.find((a) => a.role === "ORIGINAL");
  if (!original) throw new PipelineError("The uploaded file is missing. Please upload it again.");
  const path = join(ctx.workDir, `original-${safeFilename(ctx.source.originalFilename ?? "upload")}`);
  await downloadToFile(original.storageKey, path);

  const checksum = await sha256File(path);
  await db.source.update({ where: { id: ctx.source.id }, data: { checksumSha256: checksum } });

  const result = await getMalwareScanner().scan(path);
  if (!result.clean) {
    await deletePrefix(ctx.storagePrefix);
    await ctx.log("ERROR", "File rejected by malware scan", { signature: result.signature });
    throw new PipelineError("This file was flagged by our security scan and has been deleted.");
  }
  return path;
}

async function mediaPipeline(ctx: IngestContext, getInput: () => Promise<string>): Promise<void> {
  // Fail fast on configuration before spending time on extraction.
  const provider = getTranscriptionProvider();
  const input = await getInput();

  await ctx.enter("EXTRACTING_AUDIO");
  const probe = await probeMedia(input);
  if (!probe.hasAudio) throw new PipelineError("This recording has no audio track to transcribe.");
  await db.source.update({ where: { id: ctx.source.id }, data: { durationMs: probe.durationMs } });
  const audio = await extractAudio(ctx, input);
  const parts = await splitAudio(ctx, audio, probe.durationMs, { maxBytes: provider.maxBytes, chunkSeconds: env().TRANSCRIPTION_CHUNK_SECONDS });

  await ctx.enter("TRANSCRIBING", `Transcribing with ${provider.name}`);
  const segments = await transcribe(ctx, provider, parts, probe.durationMs);

  await ctx.enter("SEGMENTING");
  await segmentTranscript(ctx, segments);

  await ctx.enter("INDEXING");
  await indexChunks(ctx);
}

async function documentPipeline(ctx: IngestContext, kind: "PDF" | "SLIDES" | "DOCUMENT"): Promise<void> {
  const original = await fetchAndScan(ctx);
  await ctx.enter("PARSING_DOCUMENT", kind === "SLIDES" ? "Converting slides to PDF" : kind === "DOCUMENT" ? "Converting document to PDF" : undefined);
  const pdfPath = kind === "PDF" ? original : await convertToPdf(ctx, original);
  let pages = await parsePdf(ctx, pdfPath);

  await ctx.enter("OCR");
  pages = await ocrPdfPages(ctx, pdfPath, pages);

  await ctx.enter("SEGMENTING");
  await segmentDocument(ctx, pages, "PAGE_TEXT");

  await ctx.enter("INDEXING");
  await indexChunks(ctx);
}

const PIPELINES: Record<SourceKind, (ctx: IngestContext) => Promise<void>> = {
  VIDEO: (ctx) => mediaPipeline(ctx, () => fetchAndScan(ctx)),
  AUDIO: (ctx) => mediaPipeline(ctx, () => fetchAndScan(ctx)),
  YOUTUBE: (ctx) =>
    mediaPipeline(ctx, async () => {
      if (!env().ENABLE_YOUTUBE_INGEST) throw new PipelineError("YouTube import is not enabled on this server.");
      await ctx.enter("UPLOADING", "Downloading audio from YouTube");
      const { path, title } = await downloadYouTube(ctx);
      if (title && ctx.source.title.startsWith("YouTube ")) {
        await db.source.update({ where: { id: ctx.source.id }, data: { title: title.slice(0, 200) } });
      }
      return path;
    }),
  PDF: (ctx) => documentPipeline(ctx, "PDF"),
  SLIDES: (ctx) => documentPipeline(ctx, "SLIDES"),
  DOCUMENT: (ctx) => documentPipeline(ctx, "DOCUMENT"),
  IMAGE: async (ctx) => {
    const original = await fetchAndScan(ctx);
    await ctx.enter("OCR");
    const pages = await ocrImage(ctx, original);
    await ctx.enter("SEGMENTING");
    await segmentDocument(ctx, pages, "OCR");
    await ctx.enter("INDEXING");
    await indexChunks(ctx);
  },
  NOTE: async (ctx) => {
    const original = await fetchAndScan(ctx);
    await ctx.enter("PARSING_DOCUMENT");
    const pages = await readNote(original);
    await ctx.enter("SEGMENTING");
    await segmentDocument(ctx, pages, "NOTE_TEXT");
    await ctx.enter("INDEXING");
    await indexChunks(ctx);
  },
};

/**
 * Runs the full ingest pipeline for one source. Every stage replaces its own
 * previous output, so a retried job converges to the same result.
 */
export async function runIngestJob(jobId: string): Promise<void> {
  const job = await db.generationJob.findUnique({ where: { id: jobId } });
  // Cancelled or finished jobs can still be redelivered by the queue (e.g. a stalled job after a worker restart).
  if (!job?.sourceId || job.status === "CANCELLED" || job.status === "SUCCEEDED") return;
  const [source, studySet] = await Promise.all([
    db.source.findUnique({ where: { id: job.sourceId }, include: { assets: true } }),
    db.studySet.findUnique({ where: { id: job.studySetId } }),
  ]);
  if (!source || !studySet || studySet.deletedAt) {
    await db.generationJob.update({
      where: { id: jobId },
      data: { status: "CANCELLED", finishedAt: new Date(), events: { create: { message: "Source was deleted" } } },
    });
    return;
  }

  await db.$transaction([
    db.generationJob.update({
      where: { id: jobId },
      data: { status: "RUNNING", startedAt: job.startedAt ?? new Date(), attempts: { increment: 1 }, error: null },
    }),
    db.source.update({ where: { id: source.id }, data: { status: "PROCESSING", errorMessage: null } }),
  ]);

  const root = env().WORKER_TMP_DIR ?? join(tmpdir(), "lectureforge");
  await mkdir(root, { recursive: true });
  const workDir = await mkdtemp(join(root, `ingest-${source.id.slice(0, 8)}-`));
  const ctx = createContext(
    { job, source, studySet, workDir, storagePrefix: keys.sourcePrefix(studySet.workspaceId, studySet.id, source.id) },
    STAGE_PLANS[source.kind],
  );

  try {
    await PIPELINES[source.kind](ctx);
    await db.$transaction([
      db.source.update({ where: { id: source.id }, data: { status: "READY", processedAt: new Date() } }),
      db.generationJob.update({
        where: { id: jobId },
        data: { status: "SUCCEEDED", stage: "COMPLETE", progress: 1, finishedAt: new Date() },
      }),
    ]);
    await ctx.log("INFO", "Ready to study");
    await onSourceReady(studySet.id, job.userId);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    // If the user deleted the source mid-run, objects this run uploaded after
    // the purge job finished would be orphaned; remove them now.
    const stillExists = await db.source.count({ where: { id: source.id } });
    if (!stillExists) await deletePrefix(ctx.storagePrefix).catch(() => undefined);
  }
}

/**
 * Records a failure. When BullMQ will retry, the job goes back to QUEUED and
 * the source stays PROCESSING; on the final attempt both are marked FAILED
 * with a message the user can act on.
 */
export async function recordIngestFailure(jobId: string, err: unknown, willRetry: boolean): Promise<void> {
  const userMessage =
    err instanceof PipelineError ? err.userMessage : "Something went wrong while processing this file.";
  const detail = err instanceof Error ? err.message : String(err);
  const job = await db.generationJob.findUnique({ where: { id: jobId }, select: { sourceId: true } });
  if (!job) return;
  await db.generationJob.update({
    where: { id: jobId },
    data: {
      status: willRetry ? "QUEUED" : "FAILED",
      error: userMessage,
      finishedAt: willRetry ? null : new Date(),
      events: {
        create: {
          level: willRetry ? "WARN" : "ERROR",
          message: willRetry ? `${userMessage} Retrying…` : userMessage,
          data: { detail: detail.slice(0, 2000) },
        },
      },
    },
  });
  if (!willRetry && job.sourceId) {
    await db.source.updateMany({ where: { id: job.sourceId }, data: { status: "FAILED", errorMessage: userMessage } });
  }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
