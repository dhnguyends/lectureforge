import { z } from "zod";
import type { QuestionAnswer, QuestionOptions, QuestionResponse } from "../quiz/grade";
import type { AnchorView, JobView } from "./study-guide";

export const QUIZ_DIFFICULTIES = ["foundational", "mixed", "challenging"] as const;
export type QuizDifficultyWire = (typeof QUIZ_DIFFICULTIES)[number];
export const QUIZ_QUESTION_TYPES = ["MULTIPLE_CHOICE", "MULTI_SELECT", "SHORT_ANSWER", "NUMERICAL", "ORDERING", "MATCHING"] as const;
export type QuizQuestionType = (typeof QUIZ_QUESTION_TYPES)[number];

export const CreateQuizInputSchema = z.object({
  count: z.number().int().min(3).max(40).default(10),
  difficulty: z.enum(QUIZ_DIFFICULTIES).default("mixed"),
  types: z.array(z.enum(QUIZ_QUESTION_TYPES)).min(1).max(6).optional(),
  focus: z.string().trim().max(200).optional(),
});

const id = z.string().min(1).max(8);
export const QuestionResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), choice: id }),
  z.object({ kind: z.literal("multi"), choices: z.array(id).max(6) }),
  z.object({ kind: z.literal("ordering"), order: z.array(id).max(10) }),
  z.object({ kind: z.literal("matching"), pairs: z.record(id, id) }),
  z.object({ kind: z.literal("numerical"), value: z.string().max(60) }),
  z.object({ kind: z.literal("text"), text: z.string().max(2000) }),
]);

export const AnswerQuestionInputSchema = z.object({
  sessionId: z.uuid(),
  response: QuestionResponseSchema,
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export type QuizListItem = {
  id: string;
  title: string;
  status: "DRAFT" | "GENERATING" | "READY" | "NEEDS_REVIEW" | "FAILED";
  createdAt: string;
  questionCount: number;
  difficulty: QuizDifficultyWire;
  focus: string | null;
  /** This learner's finished attempts. */
  attempts: number;
  lastScore: number | null;
  bestScore: number | null;
  inProgress: boolean;
};

export type QuizzesOverview = { quizzes: QuizListItem[]; activeJobs: JobView[]; readySources: number; aiConfigured: boolean };

/** A question as the learner sees it before answering: no answer, no explanation. */
export type QuestionView = {
  id: string;
  order: number;
  type: QuizQuestionType;
  prompt: string;
  options: QuestionOptions;
  topic: string | null;
  difficulty: number;
};

export type AnswerResult = {
  questionId: string;
  isCorrect: boolean;
  score: number;
  feedback: string | null;
  /** Free-text answer graded by the AI model rather than by exact match. */
  judged: boolean;
  response: QuestionResponse;
  answer: QuestionAnswer;
  explanation: string;
  distractorRationale: Record<string, string> | null;
  learningObjective: string;
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  warnings: string[];
  anchors: AnchorView[];
};

export type QuizView = {
  id: string;
  title: string;
  questions: QuestionView[];
  /** The learner's unfinished attempt, if any, with the answers given so far. */
  session: { id: string; startedAt: string; results: AnswerResult[] } | null;
};

export type SessionSummary = {
  sessionId: string;
  answered: number;
  correct: number;
  /** Mean score 0..1 over answered questions (partial credit included). */
  score: number;
  durationMs: number;
  byTopic: { topic: string; answered: number; correct: number; score: number }[];
};
