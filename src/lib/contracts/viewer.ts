import { z } from "zod";

export type MediaView = {
  sourceId: string;
  kind: string;
  title: string;
  /** Short-lived signed URL for the playable/viewable file, if any. */
  url: string | null;
  mimeType: string | null;
  /** For video containers browsers cannot play (e.g. .mkv/.mov), the extracted audio. */
  audioFallbackUrl: string | null;
  youtubeId: string | null;
  durationMs: number | null;
  pageCount: number | null;
  expiresAt: string;
};

export type SegmentView = {
  id: string;
  index: number;
  startMs: number;
  endMs: number;
  speaker: string | null;
  text: string;
  edited: boolean;
  originalText: string;
  flaggedInaccurate: boolean;
  flagNote: string | null;
};

export type AnnotationView = {
  id: string;
  kind: "HIGHLIGHT" | "NOTE";
  transcriptSegmentId: string | null;
  page: number | null;
  region: unknown;
  body: string | null;
  color: string | null;
  createdAt: string;
};

export type TranscriptView = { language: string | null; provider: string; diarized: boolean; segments: SegmentView[] };

export type SourceCitationView = {
  anchorId: string;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  region: unknown;
  excerpt: string;
  claimKey: string | null;
  sectionId: string;
  sectionTitle: string;
  guideId: string;
};

export type SearchResultView = {
  chunkId: string;
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  startMs: number | null;
  page: number | null;
  headingPath: string[];
  snippet: { text: string; highlights: [number, number][] };
  match: "keyword" | "semantic" | "both";
  href: string;
};

export const PatchSegmentSchema = z
  .object({
    text: z.string().trim().min(1).max(5000).optional(),
    revert: z.literal(true).optional(),
    flaggedInaccurate: z.boolean().optional(),
    flagNote: z.string().trim().max(500).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

const bbox = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)]);

export const CreateAnnotationSchema = z
  .object({
    kind: z.enum(["HIGHLIGHT", "NOTE"]),
    transcriptSegmentId: z.uuid().optional(),
    page: z.number().int().positive().optional(),
    region: z.object({ bbox }).optional(),
    body: z.string().trim().max(5000).optional(),
    color: z.enum(["yellow", "green", "blue", "pink"]).optional(),
  })
  .refine((v) => v.transcriptSegmentId || v.page, "Attach the note to a transcript line or a page")
  .refine((v) => v.kind === "HIGHLIGHT" || (v.body && v.body.length > 0), "A note needs text");

export const UpdateAnnotationSchema = z.object({
  body: z.string().trim().max(5000).optional(),
  color: z.enum(["yellow", "green", "blue", "pink"]).optional(),
});
