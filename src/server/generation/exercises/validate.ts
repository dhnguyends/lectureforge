import type { CitationStrictness, ExerciseType } from "@prisma/client";
import { verifyExcerpt } from "@/lib/citations/verify";
import { cardKey, similar } from "../flashcards/validate";
import type { Passage, VerifiedCitation } from "../study-guide/validate";
import { TIERS, type Tier } from "./prompts";
import type { GeneratedExercise } from "./schemas";

export type ExercisePolicy = { strictness: CitationStrictness; allowExternalKnowledge: boolean };

export type FinalAnswer = { value: number; tolerance: number; unit: string };

export type ValidatedExercise = {
  tier: Tier;
  type: ExerciseType;
  grounding: "SOURCE_GROUNDED" | "TRANSFER";
  title: string;
  statement: string;
  learningObjective: string | null;
  prerequisites: string[];
  assumptions: string[];
  expectedFormat: string;
  estimatedMinutes: number;
  difficulty: number;
  hints: string[];
  solution: string;
  rubric: string[];
  finalAnswer: FinalAnswer | null;
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  confidence: number;
  warnings: string[];
  citations: VerifiedCitation[];
};

export type ExerciseStats = { proposed: number; kept: number; dropped: number; malformed: number; duplicates: number; verified: number; failedCitations: number };

const clean = (s: string, max: number) => s.trim().slice(0, max);
const list = (xs: string[], maxItems: number, maxLen: number) => xs.map((x) => clean(x, maxLen)).filter(Boolean).slice(0, maxItems);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Tolerance used when the model gives none: 1% of the value (never zero). */
export function effectiveTolerance(value: number, tolerance: number | null | undefined): number {
  return tolerance && tolerance > 0 ? tolerance : Math.max(1e-9, Math.abs(value) * 0.01);
}

/** Whether two computations of the same result agree (within the larger of the tolerance and 1%). */
export function answersAgree(expected: FinalAnswer, other: number): boolean {
  const tol = Math.max(effectiveTolerance(expected.value, expected.tolerance), Math.abs(expected.value) * 0.01);
  return Math.abs(expected.value - other) <= tol + 1e-12;
}

/**
 * Applies the grounding policy (as for guides, cards and quizzes), structural
 * checks and the tier's difficulty and time ranges; removes near-duplicates
 * (title + statement) across the whole set.
 */
export function validateExercises(
  exercises: GeneratedExercise[],
  tier: Tier,
  passages: Passage[],
  policy: ExercisePolicy,
  existingKeys: string[] = [],
): { exercises: ValidatedExercise[]; stats: ExerciseStats } {
  const byRef = new Map(passages.map((p) => [p.ref, p]));
  const stats: ExerciseStats = { proposed: exercises.length, kept: 0, dropped: 0, malformed: 0, duplicates: 0, verified: 0, failedCitations: 0 };
  const keys = [...existingKeys];
  const out: ValidatedExercise[] = [];
  const range = TIERS[tier];

  for (const e of exercises) {
    const title = clean(e.title, 160);
    const statement = clean(e.statement, 8000);
    const solution = clean(e.solution, 16000);
    const hints = list(e.hints, 4, 1000);
    const rubric = list(e.rubric, 6, 300);
    if (title.length < 3 || statement.length < 20 || solution.length < 20 || hints.length < 1 || rubric.length < 2) {
      stats.malformed++;
      continue;
    }

    const key = cardKey(`${title} ${statement.slice(0, 300)}`);
    if (keys.some((k) => similar(k, key))) {
      stats.duplicates++;
      continue;
    }

    const citations: VerifiedCitation[] = [];
    for (const c of e.citations.slice(0, 3)) {
      const passage = byRef.get(c.ref);
      if (passage && verifyExcerpt(c.excerpt, passage.text)) citations.push({ ref: c.ref, chunkId: passage.chunkId, excerpt: c.excerpt.trim() });
      else stats.failedCitations++;
    }
    const verified = citations.length > 0;
    const warnings: string[] = [];
    let claimType: ValidatedExercise["claimType"] | null;
    if (e.claimType === "external") {
      claimType = policy.allowExternalKnowledge ? "EXTERNAL" : null;
      if (claimType) warnings.push("Uses knowledge that is not in your sources.");
    } else if (!verified) {
      claimType = policy.strictness === "STRICT" ? null : "INFERENCE";
      if (claimType) warnings.push("Not linked to a verified passage of your sources — check it against your materials.");
    } else {
      claimType = e.claimType === "inference" ? "INFERENCE" : "SOURCE_GROUNDED";
    }
    if (claimType === null) {
      stats.dropped++;
      continue;
    }

    const v = e.finalAnswer.value;
    const finalAnswer = v !== null && Number.isFinite(v) ? { value: v, tolerance: effectiveTolerance(v, e.finalAnswer.tolerance), unit: clean(e.finalAnswer.unit, 30) } : null;
    if (e.type === "QUANTITATIVE" && !finalAnswer) warnings.push("No single final number to check: compare your result with the worked solution.");

    keys.push(key);
    stats.kept++;
    if (verified) stats.verified++;
    out.push({
      tier,
      type: e.type as ExerciseType,
      grounding: e.grounding === "transfer" ? "TRANSFER" : "SOURCE_GROUNDED",
      title,
      statement,
      learningObjective: clean(e.learningObjective, 300) || null,
      prerequisites: list(e.prerequisites, 6, 160),
      assumptions: list(e.assumptions, 6, 300),
      expectedFormat: clean(e.expectedFormat, 400) || "A clear, complete answer showing your reasoning.",
      estimatedMinutes: Math.round(clamp(Number.isFinite(e.estimatedMinutes) ? e.estimatedMinutes : range.minutes[0], range.minutes[0], range.minutes[1] * 2)),
      difficulty: Math.round(clamp(Number.isFinite(e.difficulty) ? e.difficulty : range.difficulty[0], range.difficulty[0], range.difficulty[1])),
      hints,
      solution,
      rubric,
      finalAnswer,
      claimType,
      confidence: Number(clamp(e.confidence * (verified ? 1 : 0.6), 0, 1).toFixed(3)),
      warnings,
      citations,
    });
  }
  return { exercises: out, stats };
}

/** Tier of a stored exercise, from its difficulty. */
export function tierOf(difficulty: number): Tier {
  return difficulty <= 2 ? "easy" : difficulty === 3 ? "intermediate" : "difficult";
}
