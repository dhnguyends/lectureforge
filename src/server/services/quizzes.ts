import type { Attempt, Prisma, QuizQuestion, StudySet } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { AnswerResult, QuestionView, QuizListItem, QuizView, QuizzesOverview, SessionSummary } from "@/lib/contracts/quiz";
import type { AnchorView, JobView } from "@/lib/contracts/study-guide";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/rate-limit";
import { grade, type QuestionAnswer, type QuestionOptions, type QuestionResponse } from "@/lib/quiz/grade";
import { getChatModel, isAiConfigured } from "@/server/ai";
import { requireStudySet } from "@/server/authz";
import type { QuizPayload } from "@/server/generation";
import { judgeShortAnswer } from "@/server/quiz/judge";
import { createAndEnqueueJob } from "./jobs";

type Actor = { id: string; ip?: string };
const ACTIVE = ["QUEUED", "RUNNING"] as const;
/** An unfinished attempt older than this is not offered for resuming. */
const RESUME_WINDOW_MS = 7 * 24 * 3600_000;
const MAX_SESSION_MS = 3 * 3600_000;

const EXPECTED_KIND: Record<QuizQuestion["type"], QuestionResponse["kind"] | null> = {
  MULTIPLE_CHOICE: "single",
  MULTI_SELECT: "multi",
  SHORT_ANSWER: "text",
  NUMERICAL: "numerical",
  ORDERING: "ordering",
  MATCHING: "matching",
  DERIVATION_STEPS: null,
  CODE_TRACING: null,
};

async function activeJobs(studySetId: string): Promise<JobView[]> {
  const jobs = await db.generationJob.findMany({
    where: {
      studySetId,
      type: "GENERATE_QUIZ",
      OR: [{ status: { in: [...ACTIVE] } }, { status: "FAILED", finishedAt: { gte: new Date(Date.now() - 3600_000) } }],
    },
    orderBy: { queuedAt: "desc" },
    take: 5,
    include: { events: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return jobs.map((j) => ({ id: j.id, type: j.type, status: j.status, progress: j.progress, error: j.error, message: j.events[0]?.message ?? null, sectionId: null }));
}

const meanScore = (attempts: Pick<Attempt, "score">[]) => (attempts.length ? attempts.reduce((n, a) => n + (a.score ?? 0), 0) / attempts.length : 0);

export async function listQuizzes(userId: string, studySetId: string): Promise<QuizzesOverview> {
  const [quizzes, jobs, readySources] = await Promise.all([
    db.quiz.findMany({
      where: { studySetId, status: { not: "GENERATING" } },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { questions: true } },
        sessions: { where: { userId }, orderBy: { createdAt: "desc" }, include: { attempts: { select: { score: true } } } },
      },
    }),
    activeJobs(studySetId),
    db.source.count({ where: { studySetId, status: "READY" } }),
  ]);
  return {
    quizzes: quizzes.map((q): QuizListItem => {
      const config = q.config as { difficulty?: QuizListItem["difficulty"]; focus?: string };
      const finished = q.sessions.filter((s) => s.endedAt && s.attempts.length);
      const scores = finished.map((s) => meanScore(s.attempts));
      const open = q.sessions.some((s) => !s.endedAt && s.createdAt.getTime() > Date.now() - RESUME_WINDOW_MS);
      return {
        id: q.id,
        title: q.title,
        status: q.status,
        createdAt: q.createdAt.toISOString(),
        questionCount: q._count.questions,
        difficulty: config.difficulty ?? "mixed",
        focus: config.focus ?? null,
        attempts: finished.length,
        lastScore: scores[0] ?? null,
        bestScore: scores.length ? Math.max(...scores) : null,
        inProgress: open,
      };
    }),
    activeJobs: jobs,
    readySources,
    aiConfigured: isAiConfigured(),
  };
}

export async function requestQuiz(actor: Actor, set: StudySet, input: QuizPayload & { count: number }): Promise<{ jobId: string }> {
  if (!isAiConfigured()) throw badRequest("AI generation is not configured on this server yet.");
  await enforceRateLimit("generation", actor.id);
  const ready = await db.source.count({ where: { studySetId: set.id, status: "READY" } });
  if (!ready) throw badRequest("Add a source and wait for it to finish processing first.");
  const running = await db.generationJob.count({ where: { studySetId: set.id, type: "GENERATE_QUIZ", status: { in: [...ACTIVE] } } });
  if (running) throw conflict("A quiz is already being generated for this set.");
  const payload: QuizPayload = { count: input.count, difficulty: input.difficulty, types: input.types, focus: input.focus || undefined };
  const jobId = await createAndEnqueueJob({ type: "GENERATE_QUIZ", studySetId: set.id, userId: actor.id, stage: "GENERATING", payload: payload as Prisma.InputJsonValue });
  await audit({ userId: actor.id, action: "generation.request", entityType: "StudySet", entityId: set.id, metadata: { kind: "quiz", ...payload } as Prisma.InputJsonValue, ip: actor.ip });
  return { jobId };
}

export async function requireQuiz(userId: string, quizId: string, min: "VIEWER" | "EDITOR" = "VIEWER") {
  const quiz = await db.quiz.findUnique({ where: { id: quizId }, select: { id: true, studySetId: true } }).catch(() => null);
  if (!quiz) throw notFound("Quiz");
  const set = await requireStudySet(userId, quiz.studySetId, min);
  return { quizId: quiz.id, set };
}

const questionInclude = { anchors: { include: { source: { select: { title: true, kind: true } } }, orderBy: { createdAt: "asc" } } } satisfies Prisma.QuizQuestionInclude;
type QuestionRow = Prisma.QuizQuestionGetPayload<{ include: typeof questionInclude }>;

function toQuestionView(q: QuizQuestion): QuestionView {
  return { id: q.id, order: q.order, type: q.type as QuestionView["type"], prompt: q.prompt, options: q.options as QuestionOptions, topic: q.topic, difficulty: q.difficulty };
}

function toResult(q: QuestionRow, a: Attempt): AnswerResult {
  const response = a.response as { response: QuestionResponse; judged?: boolean };
  return {
    questionId: q.id,
    isCorrect: a.isCorrect ?? false,
    score: a.score ?? 0,
    feedback: a.feedback,
    judged: response.judged ?? false,
    response: response.response,
    answer: q.answer as QuestionAnswer,
    explanation: q.explanation,
    distractorRationale: (q.distractorRationale as Record<string, string> | null) ?? null,
    learningObjective: q.learningObjective,
    claimType: q.claimType,
    warnings: q.warnings,
    anchors: q.anchors.map(
      (x): AnchorView => ({
        id: x.id,
        claimKey: x.claimKey,
        sourceId: x.sourceId,
        sourceTitle: x.source.title,
        sourceKind: x.source.kind,
        startMs: x.startMs,
        endMs: x.endMs,
        page: x.page,
        excerpt: x.excerpt,
        verified: x.verified,
      }),
    ),
  };
}

/** The quiz without answers, plus the learner's unfinished attempt (answers only for questions already answered). */
export async function getQuiz(userId: string, quizId: string): Promise<QuizView> {
  const quiz = await db.quiz.findUniqueOrThrow({ where: { id: quizId }, include: { questions: { orderBy: { order: "asc" }, include: questionInclude } } });
  const session = await db.studySession.findFirst({
    where: { quizId, userId, endedAt: null, createdAt: { gt: new Date(Date.now() - RESUME_WINDOW_MS) } },
    orderBy: { createdAt: "desc" },
    include: { attempts: { orderBy: { createdAt: "asc" } } },
  });
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));
  return {
    id: quiz.id,
    title: quiz.title,
    questions: quiz.questions.map(toQuestionView),
    session: session
      ? {
          id: session.id,
          startedAt: (session.startedAt ?? session.createdAt).toISOString(),
          results: session.attempts.flatMap((a) => (a.quizQuestionId && byId.has(a.quizQuestionId) ? [toResult(byId.get(a.quizQuestionId)!, a)] : [])),
        }
      : null,
  };
}

/** Starts a new attempt; any unfinished one for this quiz is closed first. */
export async function startSession(userId: string, quizId: string, studySetId: string): Promise<{ sessionId: string }> {
  await closeOpenSessions(userId, quizId);
  const s = await db.studySession.create({ data: { userId, studySetId, quizId, activity: "QUIZ", startedAt: new Date() } });
  return { sessionId: s.id };
}

async function closeOpenSessions(userId: string, quizId: string) {
  const open = await db.studySession.findMany({ where: { userId, quizId, endedAt: null }, include: { attempts: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 } } });
  for (const s of open) {
    const start = s.startedAt ?? s.createdAt;
    const last = s.attempts[0]?.createdAt ?? start;
    await db.studySession.update({ where: { id: s.id }, data: { endedAt: last, durationMs: Math.min(MAX_SESSION_MS, last.getTime() - start.getTime()) } });
  }
}

export async function answerQuestion(
  userId: string,
  questionId: string,
  input: { sessionId: string; response: QuestionResponse; durationMs?: number },
  language: string,
): Promise<AnswerResult> {
  const question = await db.quizQuestion.findUnique({ where: { id: questionId }, include: questionInclude }).catch(() => null);
  if (!question) throw notFound("Question");
  const session = await db.studySession.findUnique({ where: { id: input.sessionId } }).catch(() => null);
  if (!session || session.userId !== userId || session.quizId !== question.quizId) throw notFound("Quiz attempt");
  if (session.endedAt) throw conflict("This attempt is finished. Start a new one to answer again.");
  if (EXPECTED_KIND[question.type] !== input.response.kind) throw badRequest("That answer does not fit this type of question.");

  // Answering twice in one attempt returns the first answer (e.g. a double click).
  const existing = await db.attempt.findFirst({ where: { studySessionId: session.id, quizQuestionId: question.id } });
  if (existing) return toResult(question, existing);

  const answer = question.answer as QuestionAnswer;
  let result = grade(answer, input.response);
  let judged = false;
  if (result.needsJudgement && answer.kind === "text" && input.response.kind === "text" && isAiConfigured()) {
    try {
      await enforceRateLimit("quizJudge", userId);
      const j = await judgeShortAnswer(getChatModel(), {
        question: question.prompt,
        modelAnswer: answer.modelAnswer,
        acceptable: answer.acceptable,
        gradingNotes: answer.gradingNotes,
        studentAnswer: input.response.text,
        language,
      });
      result = { isCorrect: j.isCorrect, score: j.score, feedback: j.feedback };
      judged = true;
    } catch (err) {
      logger.warn({ err: String(err), questionId }, "short-answer judgement failed; graded by exact match only");
      result = { ...result, feedback: "Your answer could not be checked automatically. Compare it with the model answer below." };
    }
  }

  const attempt = await db.attempt.create({
    data: {
      userId,
      kind: "QUIZ_QUESTION",
      quizQuestionId: question.id,
      studySessionId: session.id,
      response: { response: input.response, judged } as Prisma.InputJsonValue,
      isCorrect: result.isCorrect,
      score: result.score,
      feedback: result.feedback ?? null,
      durationMs: input.durationMs,
    },
  });
  return toResult(question, attempt);
}

export async function finishSession(userId: string, sessionId: string): Promise<SessionSummary> {
  const session = await db.studySession.findUnique({
    where: { id: sessionId },
    include: { attempts: { include: { quizQuestion: { select: { topic: true } } } } },
  }).catch(() => null);
  if (!session || session.userId !== userId || !session.quizId) throw notFound("Quiz attempt");
  const start = session.startedAt ?? session.createdAt;
  const end = session.endedAt ?? new Date();
  const durationMs = session.durationMs ?? Math.min(MAX_SESSION_MS, end.getTime() - start.getTime());
  if (!session.endedAt) await db.studySession.update({ where: { id: session.id }, data: { endedAt: end, durationMs } });

  const topics = new Map<string, { answered: number; correct: number; score: number }>();
  for (const a of session.attempts) {
    const t = a.quizQuestion?.topic ?? "General";
    const e = topics.get(t) ?? { answered: 0, correct: 0, score: 0 };
    e.answered++;
    if (a.isCorrect) e.correct++;
    e.score += a.score ?? 0;
    topics.set(t, e);
  }
  return {
    sessionId: session.id,
    answered: session.attempts.length,
    correct: session.attempts.filter((a) => a.isCorrect).length,
    score: meanScore(session.attempts),
    durationMs,
    byTopic: [...topics.entries()]
      .map(([topic, e]) => ({ topic, answered: e.answered, correct: e.correct, score: e.score / e.answered }))
      .sort((a, b) => a.score - b.score || b.answered - a.answered),
  };
}

export async function deleteQuiz(quizId: string): Promise<void> {
  await db.quiz.delete({ where: { id: quizId } });
}
