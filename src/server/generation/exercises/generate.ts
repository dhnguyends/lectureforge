import type { GenerationJob, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Usage } from "@/server/ai";
import { PipelineError } from "@/server/pipeline/errors";
import { loadAllChunks, retrieveChunks, type RetrievedChunk } from "@/server/retrieval";
import { buildAnchors } from "../anchors";
import { cardKey } from "../flashcards/validate";
import { trimQuestions } from "../quiz/generate";
import type { GenerationContext, GenerationResult } from "../registry";
import { formatPassage } from "../study-guide/prompts";
import type { Passage } from "../study-guide/validate";
import { exerciseBatchPrompt, exerciseSystemPrompt, exerciseTypesFor, PROMPT_VERSION, SOLVER_SYSTEM, solverPrompt, type Tier } from "./prompts";
import { ExerciseBatchSchema, IndependentSolveSchema, type GeneratedExercise } from "./schemas";
import { answersAgree, validateExercises, type ExerciseStats, type ValidatedExercise } from "./validate";

export type ExercisesPayload = { easy?: number; intermediate?: number; difficult?: number; focus?: string };
export type ExerciseCounts = Record<Tier, number>;

export const DEFAULT_COUNTS: ExerciseCounts = { easy: 5, intermediate: 5, difficult: 2 };
export const MAX_PER_TIER = 10;
const TIER_ORDER: Tier[] = ["easy", "intermediate", "difficult"];
/** Passages offered to each call; beyond this the material is sampled evenly. */
const PASSAGE_BUDGET = 40_000;
const FOCUS_RETRIEVAL = 24;

export function countsFrom(payload: ExercisesPayload): ExerciseCounts {
  const n = (v: number | undefined, d: number) => Math.max(0, Math.min(MAX_PER_TIER, Math.round(v ?? d)));
  return { easy: n(payload.easy, DEFAULT_COUNTS.easy), intermediate: n(payload.intermediate, DEFAULT_COUNTS.intermediate), difficult: n(payload.difficult, DEFAULT_COUNTS.difficult) };
}

/** Passages in reading order within the budget; long material is sampled evenly so every part is represented. */
export function selectPassages(chunks: RetrievedChunk[], budget = PASSAGE_BUDGET): RetrievedChunk[] {
  const total = chunks.reduce((n, c) => n + c.tokenCount, 0);
  if (total <= budget) return chunks;
  const stride = Math.ceil(total / budget);
  const picked: RetrievedChunk[] = [];
  let tokens = 0;
  for (let i = 0; i < chunks.length; i += stride) {
    const c = chunks[i]!;
    if (tokens + c.tokenCount > budget && picked.length) break;
    picked.push(c);
    tokens += c.tokenCount;
  }
  return picked;
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

/** Stored next to the exercise (Exercise.verification): grading material and the independent check. */
export type ExerciseVerification = {
  rubric: string[];
  finalAnswer: { value: number; tolerance: number; unit: string } | null;
  check: { status: "agreed" | "disagreed" | "unchecked"; independentValue: number | null; working: string | null };
};

/** GENERATE_EXERCISES: tiers in parallel → validate → keep the requested counts → re-check numbers → store one set. */
export async function generateExercises(job: GenerationJob, ctx: GenerationContext): Promise<GenerationResult> {
  const set = await db.studySet.findUniqueOrThrow({ where: { id: job.studySetId }, include: { createdBy: { select: { profile: true } } } });
  const payload = (job.payload as ExercisesPayload | null) ?? {};
  const counts = countsFrom(payload);
  const focus = payload.focus?.trim() || undefined;
  const tiers = TIER_ORDER.filter((t) => counts[t] > 0);
  if (!tiers.length) throw new PipelineError("Ask for at least one exercise.");
  const profile = set.createdBy.profile;

  let chunks = await loadAllChunks(set.id);
  if (focus) {
    const relevant = new Set((await retrieveChunks(set.id, focus, FOCUS_RETRIEVAL)).map((c) => c.id));
    chunks = chunks.filter((c) => relevant.has(c.id));
  }
  if (!chunks.length) throw new PipelineError(focus ? `Nothing in your sources matches “${focus}”.` : "There is no processed source material to build exercises from yet.");
  const selected = selectPassages(chunks);
  const passages: Passage[] = selected.map((c, i) => ({ ref: `C${i + 1}`, chunkId: c.id, text: c.text }));
  const passagesText = selected.map((c, i) => formatPassage(`C${i + 1}`, c)).join("\n\n");
  const system = exerciseSystemPrompt(set, profile?.name ?? null, exerciseTypesFor(profile?.key));
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const add = (u: Usage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };

  // A retry of this job replaces the set from the failed attempt.
  await db.exerciseSet.deleteMany({ where: { generationJobId: job.id } });
  const exSet = await db.exerciseSet.create({
    data: {
      studySetId: set.id,
      title: (focus ? `Exercises: ${focus}` : `${set.title} — exercises`).slice(0, 200),
      config: { ...counts, ...(focus ? { focus } : {}), profile: profile?.key ?? null } as Prisma.InputJsonValue,
      status: "GENERATING",
      generationJobId: job.id,
    },
  });

  const total = tiers.reduce((n, t) => n + counts[t], 0);
  await ctx.progress(0.03, `Writing ${total} exercises (${tiers.map((t) => `${counts[t]} ${t}`).join(", ")})`);
  let done = 0;
  const outputs = await pool(tiers, env().GENERATION_CONCURRENCY, async (tier) => {
    // One more than needed per tier: some are removed by validation.
    const res = await ctx.model.generateJson({
      system,
      prompt: exerciseBatchPrompt(passagesText, tier, counts[tier] + 1, focus, []),
      schema: ExerciseBatchSchema,
      maxTokens: 32_000,
    });
    add(res.usage);
    done++;
    await ctx.progress(0.05 + 0.65 * (done / tiers.length), `Wrote the ${tier} exercises (${done}/${tiers.length})`);
    return res.data.exercises as GeneratedExercise[];
  });

  const stats: ExerciseStats = { proposed: 0, kept: 0, dropped: 0, malformed: 0, duplicates: 0, verified: 0, failedCitations: 0 };
  const policy = { strictness: set.citationStrictness, allowExternalKnowledge: set.allowExternalKnowledge && !set.sourcesOnly };
  const keys: string[] = [];
  const kept: ValidatedExercise[] = [];
  for (const [i, tier] of tiers.entries()) {
    const v = validateExercises(outputs[i]!, tier, passages, policy, keys);
    for (const k of Object.keys(stats) as (keyof ExerciseStats)[]) stats[k] += v.stats[k];
    const chosen = trimQuestions(v.exercises, counts[tier]);
    for (const e of chosen) keys.push(cardKey(`${e.title} ${e.statement.slice(0, 300)}`));
    kept.push(...chosen);
  }
  if (!kept.length) {
    await db.exerciseSet.delete({ where: { id: exSet.id } });
    throw new PipelineError("No exercises could be matched to your sources. Try a different focus or a less strict citation setting.");
  }

  // Independent re-computation of every final number, without the reference solutions.
  const checks = new Map<number, ExerciseVerification["check"]>();
  const numeric = kept.map((e, i) => ({ e, i })).filter((x) => x.e.finalAnswer);
  if (numeric.length) {
    await ctx.progress(0.75, `Re-checking ${numeric.length} numerical answer${numeric.length === 1 ? "" : "s"} independently`);
    try {
      const res = await ctx.model.generateJson({
        system: SOLVER_SYSTEM,
        prompt: solverPrompt(numeric.map(({ e, i }) => ({ id: `e${i}`, statement: e.statement, unit: e.finalAnswer!.unit }))),
        schema: IndependentSolveSchema,
        maxTokens: 16_000,
      });
      add(res.usage);
      for (const a of res.data.answers) {
        const i = Number(a.id.replace(/^e/, ""));
        const e = kept[i];
        if (!e?.finalAnswer) continue;
        const agreed = a.value !== null && answersAgree(e.finalAnswer, a.value);
        checks.set(i, { status: a.value === null ? "unchecked" : agreed ? "agreed" : "disagreed", independentValue: a.value, working: a.solution.slice(0, 600) || null });
        if (a.value !== null && !agreed) {
          e.warnings.push(`An independent re-calculation found ${a.value}${e.finalAnswer.unit ? ` ${e.finalAnswer.unit}` : ""} instead of ${e.finalAnswer.value}: the statement may be ambiguous or the worked solution wrong. Check both before relying on it.`);
          e.confidence = Number((e.confidence * 0.5).toFixed(3));
        }
      }
    } catch (err) {
      await ctx.log("WARN", "The independent re-check of numerical answers failed; answers are not double-checked.", { error: String(err) });
    }
  }

  await ctx.progress(0.9, "Saving the exercises");
  for (const [order, e] of kept.entries()) {
    const verification: ExerciseVerification = {
      rubric: e.rubric,
      finalAnswer: e.finalAnswer,
      check: checks.get(order) ?? { status: "unchecked", independentValue: null, working: null },
    };
    const row = await db.exercise.create({
      data: {
        exerciseSetId: exSet.id,
        order,
        type: e.type,
        grounding: e.grounding,
        title: e.title,
        statement: e.statement,
        prerequisites: e.prerequisites,
        assumptions: e.assumptions,
        requiredKnowledge: e.prerequisites,
        expectedFormat: e.expectedFormat,
        estimatedMinutes: e.estimatedMinutes,
        difficulty: e.difficulty,
        learningObjective: e.learningObjective,
        hints: e.hints,
        solution: e.solution,
        verification: verification as unknown as Prisma.InputJsonValue,
        claimType: e.claimType,
        confidence: e.confidence,
        warnings: e.warnings,
      },
      select: { id: true },
    });
    const anchors = await buildAnchors(
      e.citations.map((citation) => ({ claimKey: "exercise", citation })),
      { exerciseId: row.id },
    );
    if (anchors.length) await db.citationAnchor.createMany({ data: anchors });
  }

  const disagreed = [...checks.values()].filter((c) => c.status === "disagreed").length;
  const flagged = kept.filter((e) => e.warnings.length).length;
  await db.exerciseSet.update({ where: { id: exSet.id }, data: { status: flagged ? "NEEDS_REVIEW" : "READY" } });
  const byTier = Object.fromEntries(TIER_ORDER.map((t) => [t, kept.filter((e) => e.tier === t).length]));
  await ctx.log(
    stats.dropped || stats.malformed || disagreed ? "WARN" : "INFO",
    `Kept ${kept.length} exercises (${byTier.easy} easy, ${byTier.intermediate} intermediate, ${byTier.difficult} difficult); ${checks.size} numbers re-checked, ${disagreed} disagreement(s)`,
    { ...stats, disagreed },
  );
  await ctx.progress(1, `${kept.length} exercises ready`);
  return {
    result: { exerciseSetId: exSet.id, exercises: kept.length, ...byTier, requested: counts, ...stats, checked: checks.size, disagreed },
    usage,
    model: ctx.model.model,
    provider: ctx.model.provider,
    promptVersion: PROMPT_VERSION,
  };
}
