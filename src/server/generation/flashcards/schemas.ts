import { z } from "zod";
import { CLAIM_TYPES } from "@/lib/contracts/generation";

export const GENERATED_CARD_TYPES = ["BASIC", "CLOZE", "EQUATION", "CONCEPTUAL", "CODE_COMPLETION"] as const;

const ref = z.string().regex(/^C\d+$/, 'Passage refs look like "C12"');

export const CardSchema = z.object({
  type: z.enum(GENERATED_CARD_TYPES),
  /** Question side. CLOZE: the full sentence with the hidden part as {{c1::…}}. */
  front: z.string().min(1).max(1200),
  /** Answer side. CLOZE: optional extra context shown after revealing. */
  back: z.string().max(2400),
  tags: z.array(z.string().max(40)).max(6),
  learningObjective: z.string().max(300),
  claimType: z.enum(CLAIM_TYPES),
  citations: z.array(z.object({ ref, excerpt: z.string().min(1).max(500) })).max(3),
  confidence: z.number().min(0).max(1),
});
export type GeneratedCard = z.infer<typeof CardSchema>;

export const CardBatchSchema = z.object({
  cards: z.array(CardSchema).max(60),
  warnings: z.array(z.string().max(300)).max(10),
});
export type CardBatch = z.infer<typeof CardBatchSchema>;
