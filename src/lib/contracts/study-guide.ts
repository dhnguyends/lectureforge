import { z } from "zod";
import { JOB_STATUSES } from "./source";

export const GUIDE_STYLES = ["EXAM_REVISION", "DETAILED_NOTES", "TECHNICAL_OUTLINE", "CORNELL", "PAPER_READING"] as const;
export type GuideStyleWire = (typeof GUIDE_STYLES)[number];

export const CreateStudyGuideInputSchema = z.object({ style: z.enum(GUIDE_STYLES).default("DETAILED_NOTES") });

export const EditSectionInputSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  content: z.string().max(60_000),
});

export const RegenerateSectionInputSchema = z.object({
  instructions: z.string().trim().max(1000).optional(),
  /** Required to replace a section that has user edits. */
  force: z.boolean().default(false),
});

export type AnchorView = {
  id: string;
  claimKey: string | null;
  sourceId: string;
  sourceTitle: string;
  sourceKind: string;
  startMs: number | null;
  endMs: number | null;
  page: number | null;
  excerpt: string;
  verified: boolean;
};

export type SectionView = {
  id: string;
  parentId: string | null;
  order: number;
  kind: string;
  title: string;
  content: string;
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  confidence: number | null;
  warnings: string[];
  learningObjective: string | null;
  rationale: string | null;
  version: number;
  editedByUser: boolean;
  updatedAt: string;
  /** A transcript line this section cites was corrected or flagged after the section was written. */
  sourceChanged: boolean;
  anchors: AnchorView[];
};

export type JobView = {
  id: string;
  type: string;
  status: (typeof JOB_STATUSES)[number];
  progress: number;
  error: string | null;
  message: string | null;
  sectionId: string | null;
};

export type GuideView = {
  id: string;
  title: string;
  style: GuideStyleWire;
  status: "DRAFT" | "GENERATING" | "READY" | "NEEDS_REVIEW" | "FAILED";
  createdAt: string;
  sections: SectionView[];
  model: string | null;
};

export type StudyGuidesResponse = {
  guides: { id: string; title: string; style: GuideStyleWire; status: GuideView["status"]; createdAt: string }[];
  activeJobs: JobView[];
  readySources: number;
  aiConfigured: boolean;
};
