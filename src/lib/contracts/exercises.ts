import { z } from "zod";
import type { AnchorView, JobView } from "./study-guide";

export const TIER_NAMES = ["easy", "intermediate", "difficult"] as const;
export type TierName = (typeof TIER_NAMES)[number];

const perTier = (d: number) => z.number().int().min(0).max(10).default(d);
export const CreateExercisesInputSchema = z
  .object({ easy: perTier(5), intermediate: perTier(5), difficult: perTier(2), focus: z.string().trim().max(200).optional() })
  .refine((v) => v.easy + v.intermediate + v.difficult > 0, "Ask for at least one exercise.");

export const SubmitExerciseInputSchema = z.object({
  text: z.string().trim().min(1, "Write your answer first.").max(20_000),
  /** The single final number, for calculation exercises. */
  finalAnswer: z.string().trim().max(60).optional(),
  hintsUsed: z.number().int().min(0).max(10).default(0),
  durationMs: z.number().int().min(0).max(24 * 3_600_000).optional(),
});

export const HintInputSchema = z.object({ index: z.number().int().min(0).max(9) });
export const RevealSolutionInputSchema = z.object({ hintsUsed: z.number().int().min(0).max(10).default(0) });

export type ExerciseType = "DERIVATION" | "QUANTITATIVE" | "PROOF" | "ALGORITHM_DESIGN" | "CODE_DEBUGGING" | "CONCEPTUAL_TRANSFER" | "PAPER_CRITIQUE" | "CASE_ANALYSIS";
export type Verdict = "correct" | "mostly_correct" | "partially_correct" | "incorrect" | "off_topic";

export type SubmissionResult = {
  attemptId: string;
  submittedAt: string;
  text: string;
  score: number;
  verdict: Verdict;
  strengths: string[];
  gaps: string[];
  misconceptions: string[];
  feedback: string;
  nextStep: string;
  finalAnswerCheck: { given: string; correct: boolean } | null;
  hintsUsed: number;
};

export type SolutionView = {
  solution: string;
  rubric: string[];
  finalAnswer: { value: number; tolerance: number; unit: string } | null;
  /** Result of the independent re-computation done at generation time. */
  check: "agreed" | "disagreed" | "unchecked";
  anchors: AnchorView[];
};

export type ExerciseView = {
  id: string;
  order: number;
  tier: TierName;
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
  hintCount: number;
  /** Hints this learner has already opened (texts), in order. */
  hintsRevealed: string[];
  finalAnswerUnit: string | null;
  hasFinalAnswer: boolean;
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  warnings: string[];
  progress: { attempts: number; bestScore: number | null; last: SubmissionResult | null; solutionRevealed: boolean };
  /** Present once the learner has revealed it. */
  solution: SolutionView | null;
};

export type ExerciseSetView = { id: string; title: string; exercises: ExerciseView[] };

export type ExerciseSetListItem = {
  id: string;
  title: string;
  status: "DRAFT" | "GENERATING" | "READY" | "NEEDS_REVIEW" | "FAILED";
  createdAt: string;
  counts: Record<TierName, number>;
  focus: string | null;
  progress: { attempted: number; total: number; averageBest: number | null };
};

export type ExercisesOverview = { sets: ExerciseSetListItem[]; activeJobs: JobView[]; readySources: number; aiConfigured: boolean };
