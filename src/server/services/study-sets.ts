import type { JobStatus, SourceStatus, StudySet } from "@prisma/client";
import { checkSubject } from "./profiles";
import { audit } from "@/lib/audit";
import type { CreateStudySetParsed, StudySetSummary } from "@/lib/contracts/study-set";
import type { StudySetStatusResponse } from "@/lib/contracts/source";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { keys } from "@/lib/storage";
import { createAndEnqueueJob } from "./jobs";
import { ensurePersonalWorkspace } from "./workspaces";

type Actor = { id: string; ip?: string };

export async function createStudySet(actor: Actor, input: CreateStudySetParsed): Promise<{ id: string }> {
  await enforceRateLimit("createStudySet", actor.id);
  // The discipline must belong to the user's profile (Research: any).
  const subject = await checkSubject(actor.id, input.subject);
  const workspaceId = await ensurePersonalWorkspace(actor.id);
  const { advanced, examDate, ...rest } = { ...input, subject };
  const set = await db.studySet.create({
    data: {
      ...rest,
      ...advanced,
      examDate: examDate ? new Date(`${examDate}T00:00:00Z`) : null,
      workspaceId,
      createdById: actor.id,
      visibility: "PRIVATE",
    },
    select: { id: true },
  });
  await audit({ userId: actor.id, action: "study_set.create", entityType: "StudySet", entityId: set.id, ip: actor.ip });
  return set;
}

/** Study sets visible to the user: their own, plus WORKSPACE-visible sets in shared workspaces. */
function visibleWhere(userId: string) {
  return {
    deletedAt: null,
    workspace: { members: { some: { userId } } },
    OR: [{ createdById: userId }, { visibility: "WORKSPACE" as const }],
  };
}

export async function listStudySets(userId: string): Promise<StudySetSummary[]> {
  const sets = await db.studySet.findMany({
    where: { ...visibleWhere(userId), archivedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  if (sets.length === 0) return [];
  const ids = sets.map((s) => s.id);

  const [statusCounts, dueCounts] = await Promise.all([
    db.source.groupBy({ by: ["studySetId", "status"], where: { studySetId: { in: ids } }, _count: true }),
    dueCardCounts(userId, ids),
  ]);

  return sets.map((s) => {
    const counts = statusCounts.filter((c) => c.studySetId === s.id);
    const n = (statuses: SourceStatus[]) =>
      counts.filter((c) => statuses.includes(c.status)).reduce((sum, c) => sum + c._count, 0);
    return {
      id: s.id,
      title: s.title,
      course: s.course,
      subject: s.subject,
      learnerLevel: s.learnerLevel,
      examDate: s.examDate?.toISOString().slice(0, 10) ?? null,
      outputTypes: s.outputTypes,
      sourceCounts: {
        total: n(["PENDING_UPLOAD", "UPLOADED", "PROCESSING", "READY", "FAILED"]),
        ready: n(["READY"]),
        processing: n(["UPLOADED", "PROCESSING"]),
        failed: n(["FAILED"]),
      },
      dueCards: dueCounts.get(s.id) ?? 0,
      updatedAt: s.updatedAt.toISOString(),
    };
  });
}

/**
 * Cards due for this user per study set: reviewed cards whose due date has
 * passed plus cards the user has never reviewed (capped per set so a fresh
 * 500-card deck does not dominate the queue).
 */
export const NEW_CARDS_PER_DAY = 20;

export async function dueCardCounts(userId: string, studySetIds: string[]): Promise<Map<string, number>> {
  if (studySetIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ studySetId: string; due: bigint; fresh: bigint }[]>`
    SELECT d."studySetId",
           COUNT(*) FILTER (WHERE r."flashcardId" IS NOT NULL AND r.due <= now()) AS due,
           COUNT(*) FILTER (WHERE r."flashcardId" IS NULL) AS fresh
    FROM "Flashcard" f
    JOIN "FlashcardDeck" d ON d.id = f."deckId"
    LEFT JOIN "CardReviewState" r ON r."flashcardId" = f.id AND r."userId" = ${userId}::uuid
    WHERE f.suspended = false AND d."studySetId" = ANY(${studySetIds}::uuid[])
    GROUP BY d."studySetId"`;
  return new Map(rows.map((r) => [r.studySetId, Number(r.due) + Math.min(Number(r.fresh), NEW_CARDS_PER_DAY)]));
}

const ACTIVE_JOB: JobStatus[] = ["QUEUED", "RUNNING"];

export async function getStudySetStatus(studySetId: string): Promise<StudySetStatusResponse> {
  const sources = await db.source.findMany({
    where: { studySetId },
    orderBy: { createdAt: "asc" },
    include: {
      jobs: {
        where: { type: "SOURCE_INGEST" },
        orderBy: { queuedAt: "desc" },
        take: 1,
        include: { events: { orderBy: { createdAt: "desc" }, take: 8 } },
      },
    },
  });

  const view = sources.map((s) => {
    const job = s.jobs[0];
    return {
      id: s.id,
      title: s.title,
      kind: s.kind,
      status: s.status,
      sizeBytes: s.sizeBytes === null ? null : Number(s.sizeBytes),
      durationMs: s.durationMs,
      pageCount: s.pageCount,
      errorMessage: s.errorMessage,
      createdAt: s.createdAt.toISOString(),
      job: job
        ? {
            id: job.id,
            status: job.status,
            stage: job.stage,
            progress: job.progress,
            startedAt: job.startedAt?.toISOString() ?? null,
            finishedAt: job.finishedAt?.toISOString() ?? null,
            events: job.events.map((e) => ({
              id: e.id,
              level: e.level,
              stage: e.stage,
              message: e.message,
              createdAt: e.createdAt.toISOString(),
            })),
          }
        : null,
    };
  });

  return {
    studySetId,
    sources: view,
    active: view.some(
      (s) => s.status === "PENDING_UPLOAD" || s.status === "UPLOADED" || s.status === "PROCESSING" || (s.job && ACTIVE_JOB.includes(s.job.status)),
    ),
  };
}

/**
 * Permanent deletion. The row is hidden immediately (deletedAt) and a purge
 * job removes stored objects before hard-deleting the row and its cascade.
 */
export async function deleteStudySet(actor: Actor, studySet: StudySet): Promise<void> {
  await db.studySet.update({ where: { id: studySet.id }, data: { deletedAt: new Date() } });
  await createAndEnqueueJob({
    type: "PURGE_STUDY_SET",
    studySetId: studySet.id,
    userId: actor.id,
    payload: { prefix: keys.studySetPrefix(studySet.workspaceId, studySet.id) },
  });
  await audit({ userId: actor.id, action: "study_set.delete", entityType: "StudySet", entityId: studySet.id, ip: actor.ip });
}
