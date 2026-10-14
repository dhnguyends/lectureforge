import type { GuideStyle, StudySet } from "@prisma/client";
import { audit } from "@/lib/audit";
import { markersBalanced } from "@/lib/citations/markers";
import type { GuideView, JobView, SectionView, StudyGuidesResponse } from "@/lib/contracts/study-guide";
import { db } from "@/lib/db";
import { badRequest, conflict, HttpError, notFound } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { writeSectionVersion } from "@/server/generation/study-guide/generate";
import { isAiConfigured } from "@/server/generation/run";
import { requireStudySet } from "@/server/authz";
import { createAndEnqueueJob } from "./jobs";

type Actor = { id: string; ip?: string };
const ACTIVE = ["QUEUED", "RUNNING"] as const;

async function activeJobs(studySetId: string): Promise<JobView[]> {
  const jobs = await db.generationJob.findMany({
    where: {
      studySetId,
      type: { in: ["GENERATE_STUDY_GUIDE", "REGENERATE_ITEM"] },
      OR: [{ status: { in: [...ACTIVE] } }, { status: "FAILED", finishedAt: { gte: new Date(Date.now() - 3600_000) } }],
    },
    orderBy: { queuedAt: "desc" },
    take: 10,
    include: { events: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return jobs.map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    progress: j.progress,
    error: j.error,
    message: j.events[0]?.message ?? null,
    sectionId: (j.payload as { sectionId?: string } | null)?.sectionId ?? null,
  }));
}

export async function listStudyGuides(studySetId: string): Promise<StudyGuidesResponse> {
  const [guides, jobs, readySources] = await Promise.all([
    db.studyGuide.findMany({ where: { studySetId }, orderBy: { createdAt: "desc" } }),
    activeJobs(studySetId),
    db.source.count({ where: { studySetId, status: "READY" } }),
  ]);
  return {
    guides: guides.map((g) => ({ id: g.id, title: g.title, style: g.style, status: g.status, createdAt: g.createdAt.toISOString() })),
    activeJobs: jobs,
    readySources,
    aiConfigured: isAiConfigured(),
  };
}

export async function requestStudyGuide(actor: Actor, set: StudySet, style: GuideStyle): Promise<{ jobId: string }> {
  if (!isAiConfigured()) throw badRequest("AI generation is not configured on this server yet.");
  await enforceRateLimit("generation", actor.id);
  const ready = await db.source.count({ where: { studySetId: set.id, status: "READY" } });
  if (!ready) throw badRequest("Add a source and wait for it to finish processing first.");
  const running = await db.generationJob.count({ where: { studySetId: set.id, type: "GENERATE_STUDY_GUIDE", status: { in: [...ACTIVE] } } });
  if (running) throw conflict("A study guide is already being generated for this set.");
  const jobId = await createAndEnqueueJob({
    type: "GENERATE_STUDY_GUIDE",
    studySetId: set.id,
    userId: actor.id,
    stage: "GENERATING",
    payload: { style },
  });
  await audit({ userId: actor.id, action: "generation.request", entityType: "StudySet", entityId: set.id, metadata: { kind: "study_guide", style }, ip: actor.ip });
  return { jobId };
}

/** Loads a guide and checks the caller may access its study set. */
export async function requireGuide(userId: string, guideId: string, min: "VIEWER" | "EDITOR" | "OWNER" = "VIEWER") {
  const guide = await db.studyGuide.findUnique({ where: { id: guideId }, select: { id: true, studySetId: true } }).catch(() => null);
  if (!guide) throw notFound("Study guide");
  const set = await requireStudySet(userId, guide.studySetId, min);
  return { guideId: guide.id, set };
}

export async function requireSection(userId: string, sectionId: string, min: "VIEWER" | "EDITOR" = "EDITOR") {
  const section = await db.studyGuideSection
    .findUnique({ where: { id: sectionId }, include: { guide: { select: { studySetId: true } } } })
    .catch(() => null);
  if (!section) throw notFound("Section");
  const set = await requireStudySet(userId, section.guide.studySetId, min);
  return { section, set };
}

export async function getStudyGuide(guideId: string): Promise<GuideView> {
  const guide = await db.studyGuide.findUniqueOrThrow({
    where: { id: guideId },
    include: {
      sections: {
        orderBy: { order: "asc" },
        include: { anchors: { include: { source: { select: { title: true, kind: true } } }, orderBy: { createdAt: "asc" } } },
      },
    },
  });
  // Sections citing transcript lines that changed after the section was written.
  const timed = guide.sections.flatMap((sec) =>
    sec.anchors.filter((a) => a.startMs !== null).map((a) => ({ sectionId: sec.id, since: sec.updatedAt, sourceId: a.sourceId, start: a.startMs!, end: a.endMs ?? a.startMs! })),
  );
  const edited = timed.length
    ? await db.transcriptSegment.findMany({
        where: { editedAt: { not: null }, transcript: { sourceId: { in: [...new Set(timed.map((t) => t.sourceId))] } } },
        select: { startMs: true, endMs: true, editedAt: true, transcript: { select: { sourceId: true } } },
      })
    : [];
  const changed = new Set(
    timed
      .filter((t) => edited.some((e) => e.transcript.sourceId === t.sourceId && e.startMs < t.end && e.endMs > t.start && e.editedAt! > t.since))
      .map((t) => t.sectionId),
  );
  const job = guide.generationJobId
    ? await db.generationJob.findUnique({ where: { id: guide.generationJobId }, select: { model: true } })
    : null;
  return {
    id: guide.id,
    title: guide.title,
    style: guide.style,
    status: guide.status,
    createdAt: guide.createdAt.toISOString(),
    model: job?.model ?? null,
    sections: guide.sections.map(
      (s): SectionView => ({
        id: s.id,
        parentId: s.parentId,
        order: s.order,
        kind: s.kind,
        title: s.title,
        content: s.content,
        claimType: s.claimType,
        confidence: s.confidence,
        warnings: s.warnings,
        learningObjective: s.learningObjective,
        rationale: s.rationale,
        version: s.version,
        editedByUser: s.editedByUser,
        updatedAt: s.updatedAt.toISOString(),
        sourceChanged: changed.has(s.id),
        anchors: s.anchors.map((a) => ({
          id: a.id,
          claimKey: a.claimKey,
          sourceId: a.sourceId,
          sourceTitle: a.source.title,
          sourceKind: a.source.kind,
          startMs: a.startMs,
          endMs: a.endMs,
          page: a.page,
          excerpt: a.excerpt,
          verified: a.verified,
        })),
      }),
    ),
  };
}

/**
 * Saves a manual edit as a new version. Citations stay attached through the
 * [[claim:…]] markers; a marker the user deletes simply stops showing its chips.
 */
export async function editSection(actor: Actor, sectionId: string, studySetId: string, input: { title?: string; content: string }) {
  if (!markersBalanced(input.content)) throw badRequest("Citation markers are unbalanced. Each [[claim:…]] needs a matching [[/claim]].");
  await db.$transaction(async (tx) => {
    const updated = await tx.studyGuideSection.update({
      where: { id: sectionId },
      data: { content: input.content, ...(input.title ? { title: input.title } : {}), editedByUser: true, version: { increment: 1 } },
    });
    await writeSectionVersion(tx, sectionId, studySetId, updated.version, "user", actor.id);
  });
}

export async function requestSectionRegeneration(
  actor: Actor,
  section: { id: string; editedByUser: boolean },
  studySetId: string,
  input: { instructions?: string; force: boolean },
): Promise<{ jobId: string }> {
  if (!isAiConfigured()) throw badRequest("AI generation is not configured on this server yet.");
  if (section.editedByUser && !input.force) {
    throw new HttpError(409, "has_user_edits", "This section has your edits. Regenerating will replace them.");
  }
  await enforceRateLimit("generation", actor.id);
  const running = await db.generationJob.count({
    where: { studySetId, type: "REGENERATE_ITEM", status: { in: [...ACTIVE] }, payload: { path: ["sectionId"], equals: section.id } },
  });
  if (running) throw conflict("This section is already being regenerated.");
  const jobId = await createAndEnqueueJob({
    type: "REGENERATE_ITEM",
    studySetId,
    userId: actor.id,
    stage: "GENERATING",
    payload: { entityType: "StudyGuideSection", sectionId: section.id, instructions: input.instructions, force: input.force },
  });
  return { jobId };
}

export async function deleteStudyGuide(guideId: string): Promise<void> {
  await db.studyGuide.delete({ where: { id: guideId } });
}
