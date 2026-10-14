import type { ActiveJob } from "@/lib/contracts/source";
import { db } from "@/lib/db";

/** Jobs that are running, queued, or finished in the last day. */
export async function listRecentJobs(userId: string, limit = 20): Promise<ActiveJob[]> {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const jobs = await db.generationJob.findMany({
    where: {
      userId,
      type: { notIn: ["PURGE_SOURCE", "PURGE_STUDY_SET"] },
      studySet: { deletedAt: null },
      OR: [{ status: { in: ["QUEUED", "RUNNING"] } }, { finishedAt: { gte: since } }],
    },
    orderBy: { queuedAt: "desc" },
    take: limit,
    include: { studySet: { select: { title: true } }, source: { select: { title: true } } },
  });
  return jobs.map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    stage: j.stage,
    progress: j.progress,
    studySetId: j.studySetId,
    studySetTitle: j.studySet.title,
    sourceTitle: j.source?.title ?? null,
    error: j.status === "FAILED" ? j.error : null,
    queuedAt: j.queuedAt.toISOString(),
    finishedAt: j.finishedAt?.toISOString() ?? null,
  }));
}

export type ActivityItem = {
  id: string;
  kind: "source_ready" | "source_failed" | "study_set_created" | "review" | "quiz" | "exercise";
  label: string;
  studySetId: string | null;
  at: string;
};

export async function recentActivity(userId: string, limit = 12): Promise<ActivityItem[]> {
  const [sources, sets, attempts] = await Promise.all([
    db.source.findMany({
      where: {
        status: { in: ["READY", "FAILED"] },
        studySet: { createdById: userId, deletedAt: null },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, status: true, studySetId: true, updatedAt: true },
    }),
    db.studySet.findMany({
      where: { createdById: userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, title: true, createdAt: true },
    }),
    db.attempt.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, kind: true, createdAt: true, isCorrect: true },
    }),
  ]);

  const items: ActivityItem[] = [
    ...sources.map((s) => ({
      id: `src-${s.id}`,
      kind: s.status === "READY" ? ("source_ready" as const) : ("source_failed" as const),
      label: s.status === "READY" ? `“${s.title}” is ready to study` : `“${s.title}” could not be processed`,
      studySetId: s.studySetId,
      at: s.updatedAt.toISOString(),
    })),
    ...sets.map((s) => ({
      id: `set-${s.id}`,
      kind: "study_set_created" as const,
      label: `Created “${s.title}”`,
      studySetId: s.id,
      at: s.createdAt.toISOString(),
    })),
    ...attempts.map((a) => ({
      id: `att-${a.id}`,
      kind:
        a.kind === "FLASHCARD_REVIEW" ? ("review" as const) : a.kind === "QUIZ_QUESTION" ? ("quiz" as const) : ("exercise" as const),
      label:
        a.kind === "FLASHCARD_REVIEW"
          ? "Reviewed a flashcard"
          : a.kind === "QUIZ_QUESTION"
            ? `Answered a quiz question${a.isCorrect === null ? "" : a.isCorrect ? " correctly" : " incorrectly"}`
            : "Submitted an exercise attempt",
      studySetId: null,
      at: a.createdAt.toISOString(),
    })),
  ];
  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export type ProgressOverview = {
  minutesThisWeek: number;
  reviewsThisWeek: number;
  quizAccuracy: number | null; // 0..1 over the last 30 days
  quizSample: number;
  setsWithMastery: { studySetId: string; title: string; mastery: number }[];
};

export async function progressOverview(userId: string): Promise<ProgressOverview> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const [sessions, reviews, quiz, mastery] = await Promise.all([
    db.studySession.aggregate({ where: { userId, startedAt: { gte: weekAgo } }, _sum: { durationMs: true } }),
    db.attempt.count({ where: { userId, kind: "FLASHCARD_REVIEW", createdAt: { gte: weekAgo } } }),
    db.attempt.groupBy({
      by: ["isCorrect"],
      where: { userId, kind: "QUIZ_QUESTION", createdAt: { gte: monthAgo }, isCorrect: { not: null } },
      _count: true,
    }),
    db.progressMetric.findMany({
      where: { userId, metric: "MASTERY", scope: "set", studySet: { deletedAt: null } },
      orderBy: { value: "asc" },
      take: 6,
      include: { studySet: { select: { title: true } } },
    }),
  ]);
  const correct = quiz.find((q) => q.isCorrect === true)?._count ?? 0;
  const total = quiz.reduce((sum, q) => sum + q._count, 0);
  return {
    minutesThisWeek: Math.round((sessions._sum.durationMs ?? 0) / 60000),
    reviewsThisWeek: reviews,
    quizAccuracy: total ? correct / total : null,
    quizSample: total,
    setsWithMastery: mastery.map((m) => ({ studySetId: m.studySetId, title: m.studySet.title, mastery: m.value })),
  };
}
