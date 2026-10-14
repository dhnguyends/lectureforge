import { randomUUID } from "node:crypto";
import type { Prisma, StudySet } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { CompleteUploadResponse, CreateSourceInput, CreateSourceResponse } from "@/lib/contracts/source";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { badRequest, conflict } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createUploadUrl, deletePrefix, headObject, keys, readObjectHead } from "@/lib/storage";
import { estimateProcessing, MAX_SOURCES_PER_STUDY_SET, validateFile, type UploadKind } from "@/lib/uploads/policy";
import { contentMatchesKind } from "@/lib/uploads/sniff";
import { parseYouTubeUrl } from "@/lib/youtube";
import { createAndEnqueueJob } from "./jobs";

type Actor = { id: string; ip?: string };

function titleFromFilename(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return base.slice(0, 200) || "Untitled source";
}

/**
 * Step 1 of the upload workflow: validate, record the source with the rights
 * attestation, and hand back a presigned PUT. Nothing is processed until the
 * client calls completeUpload().
 */
export async function createSource(actor: Actor, studySet: StudySet, input: CreateSourceInput): Promise<CreateSourceResponse> {
  await enforceRateLimit("createSource", actor.id);

  const existing = await db.source.count({ where: { studySetId: studySet.id } });
  if (existing >= MAX_SOURCES_PER_STUDY_SET) {
    throw badRequest(`A study set can hold up to ${MAX_SOURCES_PER_STUDY_SET} sources.`);
  }

  const now = new Date();
  const sourceId = randomUUID();

  if (input.type === "youtube") {
    if (!env().ENABLE_YOUTUBE_INGEST) {
      throw badRequest("YouTube import is not enabled on this server. Upload the recording file instead.");
    }
    const parsed = parseYouTubeUrl(input.url);
    if (!parsed) throw badRequest("That does not look like a YouTube video link.");

    await db.source.create({
      data: {
        id: sourceId,
        studySetId: studySet.id,
        kind: "YOUTUBE",
        status: "UPLOADED",
        title: input.title || `YouTube ${parsed.videoId}`,
        externalUrl: parsed.canonicalUrl,
        externalId: parsed.videoId,
        rightsConfirmedAt: now,
        rightsConfirmedBy: actor.id,
      },
    });
    await auditCreate(actor, studySet.id, sourceId, "YOUTUBE", { url: parsed.canonicalUrl });
    await createAndEnqueueJob({
      type: "SOURCE_INGEST",
      studySetId: studySet.id,
      userId: actor.id,
      sourceId,
      stage: "UPLOADING",
    });
    return { sourceId, kind: "YOUTUBE", estimate: estimateProcessing({ kind: "YOUTUBE" }) };
  }

  const check = validateFile({ name: input.filename, mimeType: input.mimeType, sizeBytes: input.sizeBytes });
  if (!check.ok) throw badRequest(check.reason);

  const prefix = keys.sourcePrefix(studySet.workspaceId, studySet.id, sourceId);
  const storageKey = keys.original(prefix, input.filename);

  await db.source.create({
    data: {
      id: sourceId,
      studySetId: studySet.id,
      kind: check.kind,
      status: "PENDING_UPLOAD",
      title: input.title || titleFromFilename(input.filename),
      originalFilename: input.filename,
      mimeType: check.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      durationMs: input.durationMs,
      rightsConfirmedAt: now,
      rightsConfirmedBy: actor.id,
      assets: {
        create: { role: "ORIGINAL", storageKey, mimeType: check.mimeType, sizeBytes: BigInt(input.sizeBytes) },
      },
    },
  });
  await auditCreate(actor, studySet.id, sourceId, check.kind, { filename: input.filename, sizeBytes: input.sizeBytes });

  const upload = await createUploadUrl(storageKey, check.mimeType, input.sizeBytes);
  return {
    sourceId,
    kind: check.kind,
    estimate: estimateProcessing({ kind: check.kind, sizeBytes: input.sizeBytes, durationMs: input.durationMs }),
    upload,
  };
}

async function auditCreate(actor: Actor, studySetId: string, sourceId: string, kind: string, extra: Record<string, unknown>) {
  await audit({
    userId: actor.id,
    action: "source.rights_confirmed",
    entityType: "Source",
    entityId: sourceId,
    metadata: { studySetId, kind, ...extra, attestation: "owns-or-has-permission-for-private-study" },
    ip: actor.ip,
  });
}

/**
 * Step 2: the browser finished its PUT. Verify the object really exists with
 * the declared size and that its bytes match the declared kind, then start the
 * ingest pipeline. Idempotent — repeated calls return the same job.
 */
export async function completeUpload(actor: Actor, sourceId: string): Promise<CompleteUploadResponse> {
  const source = await db.source.findUniqueOrThrow({
    where: { id: sourceId },
    include: { assets: { where: { role: "ORIGINAL" } } },
  });

  if (source.status !== "PENDING_UPLOAD") {
    const job = await db.generationJob.findFirst({
      where: { sourceId, type: "SOURCE_INGEST" },
      orderBy: { queuedAt: "desc" },
      select: { id: true },
    });
    if (job) return { sourceId, jobId: job.id };
    throw conflict("This source has already been processed.");
  }

  const original = source.assets[0];
  if (!original) throw conflict("Source has no upload target.");

  const head = await headObject(original.storageKey);
  if (!head) throw badRequest("Upload not found. Please try uploading the file again.");
  if (BigInt(head.sizeBytes) !== source.sizeBytes) {
    throw badRequest("Uploaded size does not match the selected file. Please retry.");
  }

  const bytes = await readObjectHead(original.storageKey);
  if (!contentMatchesKind(source.kind as UploadKind, bytes)) {
    await failAndDiscard(source.id, source.studySetId, "The file contents do not match its type, so it was not processed.");
    throw badRequest("The file contents do not match its type.");
  }

  // Claim the transition atomically so concurrent calls cannot double-enqueue.
  const claimed = await db.source.updateMany({
    where: { id: sourceId, status: "PENDING_UPLOAD" },
    data: { status: "UPLOADED" },
  });
  if (claimed.count === 0) return completeUpload(actor, sourceId);

  const jobId = await createAndEnqueueJob({
    type: "SOURCE_INGEST",
    studySetId: source.studySetId,
    userId: actor.id,
    sourceId,
    stage: "SCANNING",
  });
  await audit({ userId: actor.id, action: "source.upload_complete", entityType: "Source", entityId: sourceId, ip: actor.ip });
  return { sourceId, jobId };
}

async function failAndDiscard(sourceId: string, studySetId: string, message: string) {
  const set = await db.studySet.findUniqueOrThrow({ where: { id: studySetId }, select: { workspaceId: true } });
  await db.source.update({ where: { id: sourceId }, data: { status: "FAILED", errorMessage: message } });
  try {
    await deletePrefix(keys.sourcePrefix(set.workspaceId, studySetId, sourceId));
  } catch (err) {
    logger.error({ err, sourceId }, "failed to discard rejected upload");
  }
}

/**
 * Permanent deletion of one source: rows go now (cascading to transcript,
 * chunks, anchors), stored objects are purged by a maintenance job.
 */
export async function deleteSource(actor: Actor, sourceId: string, studySet: StudySet): Promise<void> {
  const prefix = keys.sourcePrefix(studySet.workspaceId, studySet.id, sourceId);
  await db.source.delete({ where: { id: sourceId } });
  await createAndEnqueueJob({
    type: "PURGE_SOURCE",
    studySetId: studySet.id,
    userId: actor.id,
    payload: { prefix, sourceId },
  });
  await audit({ userId: actor.id, action: "source.delete", entityType: "Source", entityId: sourceId, ip: actor.ip });
}

/**
 * Re-runs processing for a source that failed. Finished transcription parts
 * from the last attempt are carried over, so a long lecture resumes rather
 * than starting again. `includeStuck` also retries sources left PROCESSING
 * by a worker that stopped (operator use only, while the worker is down).
 */
export async function retrySource(actor: Actor, sourceId: string, opts: { includeStuck?: boolean } = {}): Promise<{ jobId: string }> {
  const source = await db.source.findUniqueOrThrow({ where: { id: sourceId }, include: { assets: { where: { role: "ORIGINAL" }, select: { id: true } } } });
  const retryable = source.status === "FAILED" || (opts.includeStuck && (source.status === "PROCESSING" || source.status === "UPLOADED"));
  if (!retryable) throw conflict("Only sources whose processing failed can be retried.");
  if (source.kind !== "YOUTUBE" && source.assets.length === 0) throw conflict("The original file is missing. Please upload it again.");

  const previous = await db.generationJob.findFirst({
    where: { sourceId, type: "SOURCE_INGEST" },
    orderBy: { queuedAt: "desc" },
    select: { result: true },
  });
  await db.generationJob.updateMany({
    where: { sourceId, type: "SOURCE_INGEST", status: { in: ["QUEUED", "RUNNING"] } },
    data: { status: "CANCELLED", finishedAt: new Date(), error: "Superseded by a retry" },
  });
  await db.source.update({ where: { id: sourceId }, data: { status: "UPLOADED", errorMessage: null } });
  const jobId = await createAndEnqueueJob({
    type: "SOURCE_INGEST",
    studySetId: source.studySetId,
    userId: actor.id,
    sourceId,
    stage: source.kind === "YOUTUBE" ? "UPLOADING" : "SCANNING",
    result: (previous?.result as Prisma.InputJsonValue | null) ?? undefined,
  });
  await audit({ userId: actor.id, action: "source.retry", entityType: "Source", entityId: sourceId, ip: actor.ip });
  return { jobId };
}
