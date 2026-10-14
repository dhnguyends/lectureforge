import { z } from "zod";
import { CLAIM_TYPES } from "@/lib/contracts/generation";

/**
 * What the model returns for a quiz batch.
 *
 * One flat shape for every question type, every field required (unused ones
 * empty), and no patterns or length limits: structured outputs compile the
 * schema into a grammar, and a union of six variants with constraints is too
 * large for the API. Types, ids, counts and ranges are checked afterwards in
 * validate.ts, which drops anything malformed.
 */

export const GENERATED_QUESTION_TYPES = ["MULTIPLE_CHOICE", "MULTI_SELECT", "SHORT_ANSWER", "NUMERICAL", "ORDERING", "MATCHING"] as const;
export type GeneratedQuestionType = (typeof GENERATED_QUESTION_TYPES)[number];

export const QuestionSchema = z.object({
  type: z.enum(GENERATED_QUESTION_TYPES),
  prompt: z.string(),
  /** MULTIPLE_CHOICE / MULTI_SELECT: the options (ids a–f). Empty otherwise. */
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  /** MULTIPLE_CHOICE: one id. MULTI_SELECT: every correct id. Empty otherwise. */
  correct: z.array(z.string()),
  /** For each wrong option: the misconception it represents. */
  distractors: z.array(z.object({ id: z.string(), why: z.string() })),
  /** SHORT_ANSWER: short exact forms that are certainly right. */
  acceptableAnswers: z.array(z.string()),
  /** SHORT_ANSWER: the full model answer. */
  modelAnswer: z.string(),
  /** SHORT_ANSWER: what a correct answer must contain. */
  gradingNotes: z.string(),
  /** NUMERICAL: the answer, its absolute tolerance and its unit. */
  value: z.number().nullable(),
  tolerance: z.number().nullable(),
  unit: z.string(),
  /** ORDERING: items in their correct order. */
  itemsInOrder: z.array(z.string()),
  /** MATCHING: the correct pairs. */
  pairs: z.array(z.object({ left: z.string(), right: z.string() })),
  /** Why the answer is right, worked through for calculations. */
  explanation: z.string(),
  learningObjective: z.string(),
  topic: z.string(),
  difficulty: z.number(),
  claimType: z.enum(CLAIM_TYPES),
  citations: z.array(z.object({ ref: z.string(), excerpt: z.string() })),
  confidence: z.number(),
});
export type GeneratedQuestion = z.infer<typeof QuestionSchema>;

export const QuizBatchSchema = z.object({
  questions: z.array(QuestionSchema),
  warnings: z.array(z.string()),
});
