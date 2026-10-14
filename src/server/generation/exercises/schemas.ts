import { z } from "zod";
import { CLAIM_TYPES } from "@/lib/contracts/generation";

/**
 * What the model returns for a batch of exercises. Flat, every field required
 * and no patterns or length limits (structured outputs compile the schema into
 * a grammar; constraints are checked afterwards in validate.ts).
 */

export const GENERATED_EXERCISE_TYPES = [
  "DERIVATION",
  "QUANTITATIVE",
  "PROOF",
  "ALGORITHM_DESIGN",
  "CODE_DEBUGGING",
  "CONCEPTUAL_TRANSFER",
  "PAPER_CRITIQUE",
  "CASE_ANALYSIS",
] as const;
export type GeneratedExerciseType = (typeof GENERATED_EXERCISE_TYPES)[number];

export const ExerciseSchema = z.object({
  type: z.enum(GENERATED_EXERCISE_TYPES),
  /** source_grounded: practises the material as taught; transfer: applies it to a new situation. */
  grounding: z.enum(["source_grounded", "transfer"]),
  title: z.string(),
  /** Markdown with LaTeX; everything the student needs, no answer. */
  statement: z.string(),
  learningObjective: z.string(),
  prerequisites: z.array(z.string()),
  assumptions: z.array(z.string()),
  /** What the answer should look like ("a short derivation ending in …", "a recommendation memo of 150 words"). */
  expectedFormat: z.string(),
  estimatedMinutes: z.number(),
  difficulty: z.number(),
  /** Progressive: a nudge, then the method, then a key step. Never the final answer. */
  hints: z.array(z.string()),
  /** Complete worked solution (Markdown with LaTeX). */
  solution: z.string(),
  /** Gradable criteria a complete answer meets. */
  rubric: z.array(z.string()),
  /** For calculations: the final number, an absolute tolerance and the unit; value null otherwise. */
  finalAnswer: z.object({ value: z.number().nullable(), tolerance: z.number().nullable(), unit: z.string() }),
  claimType: z.enum(CLAIM_TYPES),
  citations: z.array(z.object({ ref: z.string(), excerpt: z.string() })),
  confidence: z.number(),
});
export type GeneratedExercise = z.infer<typeof ExerciseSchema>;

export const ExerciseBatchSchema = z.object({
  exercises: z.array(ExerciseSchema),
  warnings: z.array(z.string()),
});

/**
 * Independent re-solution of the calculation exercises (no access to the
 * reference solutions). Field order matters: structured output is generated in
 * schema order, so the short model solution comes before its final number.
 */
export const IndependentSolveSchema = z.object({
  answers: z.array(z.object({ id: z.string(), solution: z.string(), value: z.number().nullable() })),
});
