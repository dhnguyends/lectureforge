import { z } from "zod";
import { isTimestamp } from "../time";

/**
 * Prompt contract shared by every AI generation call. Model output is parsed
 * with these schemas; anything that fails validation is rejected or repaired,
 * never stored as-is.
 */

export const CLAIM_TYPES = ["source_grounded", "inference", "external"] as const;
export type ClaimTypeWire = (typeof CLAIM_TYPES)[number];

const timestamp = z.string().refine(isTimestamp, "Expected HH:MM:SS.mmm");

export const CitationAnchorSchema = z
  .object({
    sourceId: z.uuid(),
    sourceType: z.enum(["video", "audio", "pdf", "slide", "document", "note"]),
    start: timestamp.optional(),
    end: timestamp.optional(),
    page: z.number().int().positive().optional(),
    chunkId: z.uuid(),
    excerpt: z.string().min(1).max(500),
  })
  .superRefine((a, ctx) => {
    const timed = a.sourceType === "video" || a.sourceType === "audio";
    if (timed && (!a.start || !a.end)) {
      ctx.addIssue({ code: "custom", message: "Video/audio anchors need start and end timestamps" });
    }
    if ((a.sourceType === "pdf" || a.sourceType === "slide" || a.sourceType === "document") && a.page === undefined) {
      ctx.addIssue({ code: "custom", message: "PDF/slide anchors need a page number" });
    }
  });
export type CitationAnchorWire = z.infer<typeof CitationAnchorSchema>;

/** Fields every generated item carries. */
export const GeneratedItemBaseSchema = z
  .object({
    title: z.string().min(1),
    content: z.string().min(1),
    sourceAnchors: z.array(CitationAnchorSchema),
    confidence: z.number().min(0).max(1),
    claimType: z.enum(CLAIM_TYPES),
    warnings: z.array(z.string()).default([]),
    learningObjective: z.string().optional(),
    difficulty: z.number().int().min(1).max(5).optional(),
    rationale: z.string().optional(),
  })
  .refine((v) => v.claimType !== "source_grounded" || v.sourceAnchors.length > 0, {
    message: "Source-grounded content must cite at least one anchor",
    path: ["sourceAnchors"],
  });
export type GeneratedItemBase = z.infer<typeof GeneratedItemBaseSchema>;

/** Confidence below this shows a visible "inspect the source" warning. */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;
