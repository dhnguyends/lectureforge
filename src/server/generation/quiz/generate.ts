import type { GenerationJob, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Usage } from "@/server/ai";
import { PipelineError } from "@/server/pipeline/errors";
import { loadAllChunks, retrieveChunks } from "@/server/retrieval";
import { buildAnchors } from "../anchors";
import { batchChunks } from "../flashcards/generate";
import { cardKey } from "../flashcards/validate";
import type { GenerationContext, GenerationResult } from "../registry";
import { PROMPT_VERSION, quizBatchPrompt, quizSystemPrompt, type QuizDifficulty } from "./prompts";
import { GENERATED_QUESTION_TYPES, QuizBatchSchema, type GeneratedQuestion, type GeneratedQuestionType } from "./schemas";
import { validateQuestions, type QuestionStats, type ValidatedQuestion } from "./validate";

export type QuizPayload = { count?: number; difficulty?: QuizDifficulty; types?: GeneratedQuestionType[]; focus?: string };

export const DEFAULT_QUESTIONS = 10;
export const MAX_QUESTIONS = 40;
/** Ask for a few more than needed: some are removed by validation. */
const OVERSHOOT = 1.25;
const FOCUS_RETRIEVAL = 24;

/** Batch size so that each call writes about four questions, within sensible bounds. */
export function quizBatchBudget(totalTokens: number, count: number): number {
  return Math.min(40_000, Math.max(10_000, Math.ceil(totalTokens / Math.max(1, Math.ceil(count / 4)))));
}

/** Keeps `count` questions: drops the least confident ones, then restores course order. */
export function trimQuestions<T extends { confidence: number }>(questions: T[], count: number): T[] {
  if (questions.length <= count) return questions;
  const keep = new Set(
    questions
      .map((q, i) => ({ q, i }))
      .sort((a, b) => b.q.confidence - a.q.confidence || a.i - b.i)
      .slice(0, count)
      .map((x) => x.i),
  );
  return questions.filter((_, i) => keep.has(i));
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

/** GENERATE_QUIZ: batch passages → questions → verify citations and structure → store one quiz. */
export async function generateQuiz(job: GenerationJob, ctx: GenerationContext): Promise<GenerationResult> {
  const set = await db.studySet.findUniqueOrThrow({ where: { id: job.studySetId } });
  const payload = (job.payload as QuizPayload | null) ?? {};
  const focus = payload.focus?.trim() || undefined;
  const count = Math.max(3, Math.min(MAX_QUESTIONS, payload.count ?? DEFAULT_QUESTIONS));
  const difficulty: QuizDifficulty = payload.difficulty ?? "mixed";
  const types = payload.types?.length ? payload.types.filter((t) => GENERATED_QUESTION_TYPES.includes(t)) : [...GENERATED_QUESTION_TYPES];

  let chunks = await loadAllChunks(set.id);
  if (focus) {
    const relevant = new Set((await retrieveChunks(set.id, focus, FOCUS_RETRIEVAL)).map((c) => c.id));
    chunks = chunks.filter((c) => relevant.has(c.id));
  }
  if (!chunks.length) throw new PipelineError(focus ? `Nothing in your sources matches “${focus}”.` : "There is no processed source material to build a quiz from yet.");

  const totalTokens = chunks.reduce((n, c) => n + c.tokenCount, 0);
  const batches = batchChunks(chunks, quizBatchBudget(totalTokens, count));
  const system = quizSystemPrompt(set);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  // A retry of this job replaces the quiz from the failed attempt.
  await db.quiz.deleteMany({ where: { generationJobId: job.id } });
  const quiz = await db.quiz.create({
    data: {
      studySetId: set.id,
      title: (focus ? `Quiz: ${focus}` : `${set.title} — quiz`).slice(0, 200),
      config: { count, difficulty, types, ...(focus ? { focus } : {}) } as Prisma.InputJsonValue,
      status: "GENERATING",
      generationJobId: job.id,
    },
  });

  await ctx.progress(0.03, `Writing ${count} questions from ${batches.length} part${batches.length === 1 ? "" : "s"} of your materials`);
  let done = 0;
  const outputs = await pool(batches, env().GENERATION_CONCURRENCY, async (batch) => {
    const want = Math.max(1, Math.ceil(((count * batch.tokens) / totalTokens) * OVERSHOOT));
    const res = await ctx.model.generateJson({
      system,
      prompt: quizBatchPrompt(batch.text, want, difficulty, types, focus),
      schema: QuizBatchSchema,
      maxTokens: 20_000,
    });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    done++;
    await ctx.progress(0.05 + 0.75 * (done / batches.length), `Drafted questions for part ${done} of ${batches.length}`);
    return res.data.questions as GeneratedQuestion[];
  });

  const stats: QuestionStats = { proposed: 0, kept: 0, dropped: 0, malformed: 0, duplicates: 0, verified: 0, failedCitations: 0 };
  const policy = { strictness: set.citationStrictness, allowExternalKnowledge: set.allowExternalKnowledge && !set.sourcesOnly };
  const keys: string[] = [];
  const valid: ValidatedQuestion[] = [];
  for (const [i, questions] of outputs.entries()) {
    const v = validateQuestions(questions, batches[i]!.passages, policy, keys);
    for (const k of Object.keys(stats) as (keyof QuestionStats)[]) stats[k] += v.stats[k];
    for (const q of v.questions) keys.push(cardKey(q.prompt));
    valid.push(...v.questions);
  }
  const selected = trimQuestions(valid, count);
  if (!selected.length) {
    await db.quiz.delete({ where: { id: quiz.id } });
    throw new PipelineError("No quiz questions could be matched to your sources. Try a different focus or a less strict citation setting.");
  }

  for (const [order, q] of selected.entries()) {
    const row = await db.quizQuestion.create({
      data: {
        quizId: quiz.id,
        order,
        type: q.type,
        prompt: q.prompt,
        options: q.options as Prisma.InputJsonValue,
        answer: q.answer as Prisma.InputJsonValue,
        explanation: q.explanation,
        distractorRationale: q.distractorRationale ?? undefined,
        learningObjective: q.learningObjective,
        topic: q.topic,
        difficulty: q.difficulty,
        claimType: q.claimType,
        confidence: q.confidence,
        warnings: q.warnings,
      },
      select: { id: true },
    });
    const anchors = await buildAnchors(
      q.citations.map((citation) => ({ claimKey: "question", citation })),
      { quizQuestionId: row.id },
    );
    if (anchors.length) await db.citationAnchor.createMany({ data: anchors });
  }

  const flagged = selected.filter((q) => q.warnings.length).length;
  await db.quiz.update({ where: { id: quiz.id }, data: { status: flagged ? "NEEDS_REVIEW" : "READY" } });
  await ctx.log(
    stats.dropped || stats.malformed ? "WARN" : "INFO",
    `Kept ${selected.length} questions (${stats.proposed} drafted: ${stats.verified} verified, ${stats.dropped} unsupported and ${stats.malformed} malformed removed, ${stats.duplicates} duplicates)`,
    stats,
  );
  await ctx.progress(1, `${selected.length} questions ready`);
  return {
    result: { quizId: quiz.id, questions: selected.length, requested: count, ...stats },
    usage,
    model: ctx.model.model,
    provider: ctx.model.provider,
    promptVersion: PROMPT_VERSION,
  };
}
