import type { Attempt, Prisma, StudySet } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { ExerciseSetListItem, ExerciseSetView, ExercisesOverview, ExerciseView, SolutionView, SubmissionResult, TierName } from "@/lib/contracts/exercises";
import type { AnchorView, JobView } from "@/lib/contracts/study-guide";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { parseNumber } from "@/lib/quiz/grade";
import { enforceRateLimit } from "@/lib/rate-limit";
import { AiError, getChatModel, isAiConfigured } from "@/server/ai";
import { requireStudySet } from "@/server/authz";
import { gradeExerciseAnswer, type Verdict } from "@/server/exercises/grade";
import type { ExerciseVerification } from "@/server/generation/exercises/generate";
import { answersAgree, tierOf } from "@/server/generation/exercises/validate";
import { createAndEnqueueJob } from "./jobs";

type Actor = { id: string; ip?: string };
const ACTIVE = ["QUEUED", "RUNNING"] as const;

async function activeJobs(studySetId: string): Promise<JobView[]> {
  const jobs = await db.generationJob.findMany({
    where: {
      studySetId,
      type: "GENERATE_EXERCISES",
      OR: [{ status: { in: [...ACTIVE] } }, { status: "FAILED", finishedAt: { gte: new Date(Date.now() - 3600_000) } }],
    },
    orderBy: { queuedAt: "desc" },
    take: 5,
    include: { events: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return jobs.map((j) => ({ id: j.id, type: j.type, status: j.status, progress: j.progress, error: j.error, message: j.events[0]?.message ?? null, sectionId: null }));
}

const graded = (a: Pick<Attempt, "score" | "solutionRevealed">) => a.score !== null && !a.solutionRevealed;

export async function listExerciseSets(userId: string, studySetId: string): Promise<ExercisesOverview> {
  const [sets, jobs, readySources] = await Promise.all([
    db.exerciseSet.findMany({
      where: { studySetId, status: { not: "GENERATING" } },
      orderBy: { createdAt: "desc" },
      include: { exercises: { select: { difficulty: true, attempts: { where: { userId }, select: { score: true, solutionRevealed: true } } } } },
    }),
    activeJobs(studySetId),
    db.source.count({ where: { studySetId, status: "READY" } }),
  ]);
  return {
    sets: sets.map((s): ExerciseSetListItem => {
      const config = s.config as { focus?: string };
      const counts: Record<TierName, number> = { easy: 0, intermediate: 0, difficult: 0 };
      const bests: number[] = [];
      for (const e of s.exercises) {
        counts[tierOf(e.difficulty)]++;
        const scores = e.attempts.filter(graded).map((a) => a.score!);
        if (scores.length) bests.push(Math.max(...scores));
      }
      return {
        id: s.id,
        title: s.title,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
        counts,
        focus: config.focus ?? null,
        progress: { attempted: bests.length, total: s.exercises.length, averageBest: bests.length ? bests.reduce((a, b) => a + b, 0) / bests.length : null },
      };
    }),
    activeJobs: jobs,
    readySources,
    aiConfigured: isAiConfigured(),
  };
}

export async function requestExercises(actor: Actor, set: StudySet, input: { easy: number; intermediate: number; difficult: number; focus?: string }): Promise<{ jobId: string }> {
  if (!isAiConfigured()) throw badRequest("AI generation is not configured on this server yet.");
  await enforceRateLimit("generation", actor.id);
  const ready = await db.source.count({ where: { studySetId: set.id, status: "READY" } });
  if (!ready) throw badRequest("Add a source and wait for it to finish processing first.");
  const running = await db.generationJob.count({ where: { studySetId: set.id, type: "GENERATE_EXERCISES", status: { in: [...ACTIVE] } } });
  if (running) throw conflict("Exercises are already being generated for this set.");
  const payload = { easy: input.easy, intermediate: input.intermediate, difficult: input.difficult, ...(input.focus ? { focus: input.focus } : {}) };
  const jobId = await createAndEnqueueJob({ type: "GENERATE_EXERCISES", studySetId: set.id, userId: actor.id, stage: "GENERATING", payload });
  await audit({ userId: actor.id, action: "generation.request", entityType: "StudySet", entityId: set.id, metadata: { kind: "exercises", ...payload }, ip: actor.ip });
  return { jobId };
}

export async function requireExerciseSet(userId: string, exerciseSetId: string, min: "VIEWER" | "EDITOR" = "VIEWER") {
  const s = await db.exerciseSet.findUnique({ where: { id: exerciseSetId }, select: { id: true, studySetId: true } }).catch(() => null);
  if (!s) throw notFound("Exercise set");
  const set = await requireStudySet(userId, s.studySetId, min);
  return { exerciseSetId: s.id, set };
}

export async function requireExercise(userId: string, exerciseId: string) {
  const e = await db.exercise.findUnique({ where: { id: exerciseId }, include: { exerciseSet: { select: { studySetId: true } } } }).catch(() => null);
  if (!e) throw notFound("Exercise");
  const set = await requireStudySet(userId, e.exerciseSet.studySetId);
  return { exercise: e, set };
}

const anchorInclude = { anchors: { include: { source: { select: { title: true, kind: true } } }, orderBy: { createdAt: "asc" } } } satisfies Prisma.ExerciseInclude;

function anchorViews(anchors: Prisma.ExerciseGetPayload<{ include: typeof anchorInclude }>["anchors"]): AnchorView[] {
  return anchors.map((a) => ({
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
  }));
}

type SubmissionData = Omit<SubmissionResult, "attemptId" | "submittedAt" | "score" | "feedback" | "hintsUsed">;

function toSubmission(a: Attempt): SubmissionResult | null {
  if (!graded(a)) return null;
  const r = a.response as SubmissionData;
  return {
    attemptId: a.id,
    submittedAt: a.createdAt.toISOString(),
    text: r.text,
    score: a.score!,
    verdict: r.verdict,
    strengths: r.strengths ?? [],
    gaps: r.gaps ?? [],
    misconceptions: r.misconceptions ?? [],
    feedback: a.feedback ?? "",
    nextStep: r.nextStep ?? "",
    finalAnswerCheck: r.finalAnswerCheck ?? null,
    hintsUsed: a.hintsUsed,
  };
}

function solutionView(e: { solution: string; verification: Prisma.JsonValue }, anchors: AnchorView[]): SolutionView {
  const v = (e.verification ?? {}) as Partial<ExerciseVerification>;
  return { solution: e.solution, rubric: v.rubric ?? [], finalAnswer: v.finalAnswer ?? null, check: v.check?.status ?? "unchecked", anchors };
}

/** The set for a learner: statements and their own progress; hints and solution only as far as they have opened them. */
export async function getExerciseSet(userId: string, exerciseSetId: string): Promise<ExerciseSetView> {
  const s = await db.exerciseSet.findUniqueOrThrow({
    where: { id: exerciseSetId },
    include: { exercises: { orderBy: { order: "asc" }, include: { ...anchorInclude, attempts: { where: { userId }, orderBy: { createdAt: "asc" } } } } },
  });
  return {
    id: s.id,
    title: s.title,
    exercises: s.exercises.map((e): ExerciseView => {
      const v = (e.verification ?? {}) as Partial<ExerciseVerification>;
      const hints = (e.hints as string[] | null) ?? [];
      const submissions = e.attempts.map(toSubmission).filter((x): x is SubmissionResult => x !== null);
      const revealed = e.attempts.some((a) => a.solutionRevealed);
      const hintsUsed = Math.max(0, ...e.attempts.map((a) => a.hintsUsed));
      return {
        id: e.id,
        order: e.order,
        tier: tierOf(e.difficulty),
        type: e.type,
        grounding: e.grounding,
        title: e.title,
        statement: e.statement,
        learningObjective: e.learningObjective,
        prerequisites: e.prerequisites,
        assumptions: e.assumptions,
        expectedFormat: e.expectedFormat,
        estimatedMinutes: e.estimatedMinutes,
        difficulty: e.difficulty,
        hintCount: hints.length,
        hintsRevealed: hints.slice(0, revealed ? hints.length : hintsUsed),
        finalAnswerUnit: v.finalAnswer?.unit || null,
        hasFinalAnswer: Boolean(v.finalAnswer),
        claimType: e.claimType,
        warnings: e.warnings,
        progress: {
          attempts: submissions.length,
          bestScore: submissions.length ? Math.max(...submissions.map((x) => x.score)) : null,
          last: submissions.at(-1) ?? null,
          solutionRevealed: revealed,
        },
        solution: revealed ? solutionView(e, anchorViews(e.anchors)) : null,
      };
    }),
  };
}

export async function getHint(exerciseId: string, index: number): Promise<{ index: number; text: string }> {
  const e = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId }, select: { hints: true } });
  const hints = (e.hints as string[] | null) ?? [];
  if (index >= hints.length) throw badRequest("There are no more hints for this exercise.");
  return { index, text: hints[index]! };
}

export async function submitAnswer(
  userId: string,
  exerciseId: string,
  input: { text: string; finalAnswer?: string; hintsUsed: number; durationMs?: number },
  language: string,
): Promise<SubmissionResult> {
  if (!isAiConfigured()) throw badRequest("Answers are graded by the AI model, which is not configured on this server.");
  await enforceRateLimit("quizJudge", userId);
  const e = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId } });
  const v = (e.verification ?? {}) as Partial<ExerciseVerification>;

  let finalAnswerCheck: SubmissionResult["finalAnswerCheck"] = null;
  if (v.finalAnswer && input.finalAnswer) {
    const n = parseNumber(input.finalAnswer);
    finalAnswerCheck = { given: input.finalAnswer, correct: n !== null && answersAgree(v.finalAnswer, n) };
  }

  let grade;
  try {
    ({ grade } = await gradeExerciseAnswer(getChatModel(), {
      language,
      statement: e.statement,
      expectedFormat: e.expectedFormat,
      rubric: v.rubric ?? [],
      solution: e.solution,
      finalAnswer: v.finalAnswer ? { value: v.finalAnswer.value, unit: v.finalAnswer.unit } : null,
      studentAnswer: input.text,
      studentFinal: finalAnswerCheck,
      hintsUsed: input.hintsUsed,
    }));
  } catch (err) {
    logger.warn({ err: String(err), exerciseId }, "exercise grading failed");
    throw err instanceof AiError ? badRequest(`Your answer could not be graded: ${err.userMessage}`) : err;
  }

  const data: SubmissionData = {
    text: input.text,
    verdict: grade.verdict as Verdict,
    strengths: grade.strengths,
    gaps: grade.gaps,
    misconceptions: grade.misconceptions,
    nextStep: grade.nextStep,
    finalAnswerCheck,
  };
  const attempt = await db.attempt.create({
    data: {
      userId,
      kind: "EXERCISE_SUBMISSION",
      exerciseId,
      response: data as unknown as Prisma.InputJsonValue,
      isCorrect: grade.verdict === "correct" || (grade.verdict === "mostly_correct" && grade.score >= 0.8),
      score: grade.score,
      feedback: grade.feedback,
      hintsUsed: input.hintsUsed,
      durationMs: input.durationMs,
    },
  });
  return toSubmission(attempt)!;
}

/** Shows the worked solution and records that it was revealed (so the next attempt is not counted as unaided). */
export async function revealSolution(userId: string, exerciseId: string, hintsUsed: number): Promise<SolutionView> {
  const e = await db.exercise.findUniqueOrThrow({ where: { id: exerciseId }, include: anchorInclude });
  await db.attempt.create({
    data: { userId, kind: "EXERCISE_SUBMISSION", exerciseId, solutionRevealed: true, hintsUsed, response: { revealOnly: true } },
  });
  return solutionView(e, anchorViews(e.anchors));
}

export async function deleteExerciseSet(exerciseSetId: string): Promise<void> {
  await db.exerciseSet.delete({ where: { id: exerciseSetId } });
}
