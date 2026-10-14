import { z } from "zod";
import { CLAIM_TYPES } from "@/lib/contracts/generation";

/**
 * What the model must return. Passages are referred to by short refs ("C12")
 * rather than UUIDs: cheaper, and a hallucinated ref is easy to detect.
 */

export const GUIDE_SECTION_KINDS = [
  "LEARNING_OBJECTIVES",
  "VOCABULARY",
  "CONCEPTS",
  "DEFINITIONS",
  "EQUATIONS",
  "ASSUMPTIONS",
  "DERIVATION",
  "WORKED_EXAMPLE",
  "MISCONCEPTIONS",
  "PREREQUISITES",
  "RECALL_PROMPTS",
  "NOTES",
] as const;

const ref = z.string().regex(/^C\d+$/, 'Passage refs look like "C12"');

export const OutlineSchema = z.object({
  title: z.string().min(1).max(200),
  sections: z
    .array(
      z.object({
        key: z.string().regex(/^s\d+$/, 'Section keys look like "s1"'),
        level: z.number().int().min(1).max(2),
        kind: z.enum(GUIDE_SECTION_KINDS),
        title: z.string().min(1).max(160),
        learningObjective: z.string().max(400),
        sourceRefs: z.array(ref).max(24),
      }),
    )
    .min(1)
    .max(40),
});
export type Outline = z.infer<typeof OutlineSchema>;

export const SectionOutputSchema = z.object({
  /** Markdown. Every factual statement is wrapped: [[claim:k1]]…[[/claim]] */
  content: z.string().min(1),
  claims: z
    .array(
      z.object({
        key: z.string().regex(/^k\d+$/, 'Claim keys look like "k1"'),
        claimType: z.enum(CLAIM_TYPES),
        citations: z
          .array(z.object({ ref, excerpt: z.string().min(1).max(500) }))
          .max(4),
      }),
    )
    .max(120),
  /** True when the whole section is an AI-created practice example. */
  aiCreatedPractice: z.boolean(),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(300)).max(10),
});
export type SectionOutput = z.infer<typeof SectionOutputSchema>;
