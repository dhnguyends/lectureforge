import { z } from "zod";
import { RATINGS, type Rating } from "../srs/fsrs";
import type { AnchorView, JobView } from "./study-guide";

export const CreateFlashcardsInputSchema = z.object({
  /** Cards to aim for; omitted = sized to the material and the set's detail level. */
  count: z.number().int().min(5).max(200).optional(),
  /** Restrict to material about this topic. */
  focus: z.string().trim().max(200).optional(),
});

export const ReviewCardInputSchema = z.object({
  rating: z.enum(RATINGS),
  /** Time from showing the card to answering, for analytics. */
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
});

export const EditCardInputSchema = z
  .object({
    front: z.string().trim().min(1).max(1200).optional(),
    back: z.string().trim().max(2400).optional(),
    suspended: z.boolean().optional(),
  })
  .refine((v) => v.front !== undefined || v.back !== undefined || v.suspended !== undefined, "Nothing to change.");

export type CardType = "BASIC" | "CLOZE" | "EQUATION" | "IMAGE_LABEL" | "CODE_COMPLETION" | "CONCEPTUAL";
export type CardState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

export type CardView = {
  id: string;
  deckId: string;
  type: CardType;
  front: string;
  back: string;
  tags: string[];
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  confidence: number | null;
  warnings: string[];
  learningObjective: string | null;
  suspended: boolean;
  editedByUser: boolean;
  anchors: AnchorView[];
  /** This learner's schedule; null = never reviewed. */
  review: { state: CardState; due: string; reps: number; lapses: number } | null;
};

export type DeckView = { id: string; title: string; createdAt: string; cards: number; suspended: number };

export type FlashcardsOverview = {
  decks: DeckView[];
  counts: {
    total: number;
    /** Reviewed before and due now. */
    due: number;
    /** Never reviewed, still allowed today (daily new-card limit). */
    newToday: number;
    /** Never reviewed, in total. */
    unseen: number;
    /** Reviewed at least once. */
    learned: number;
  };
  activeJobs: JobView[];
  readySources: number;
  aiConfigured: boolean;
};

export type QueueCard = CardView & {
  /** Time until the card comes back for each answer, e.g. { GOOD: "3 d" }. */
  intervals: Record<Rating, string>;
};

export type ReviewQueue = { cards: QueueCard[]; due: number; newToday: number };

export type ReviewResult = { cardId: string; state: CardState; due: string; intervalLabel: string };

export type CardsResponse = { cards: CardView[] };
