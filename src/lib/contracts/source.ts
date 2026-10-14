import { z } from "zod";

export const SOURCE_KINDS = ["VIDEO", "AUDIO", "PDF", "SLIDES", "DOCUMENT", "IMAGE", "NOTE", "YOUTUBE"] as const;
export const SOURCE_STATUSES = ["PENDING_UPLOAD", "UPLOADED", "PROCESSING", "READY", "FAILED"] as const;
export const PROCESSING_STAGES = [
  "UPLOADING",
  "SCANNING",
  "EXTRACTING_AUDIO",
  "TRANSCRIBING",
  "PARSING_DOCUMENT",
  "OCR",
  "SEGMENTING",
  "INDEXING",
  "GENERATING",
  "VALIDATING",
  "COMPLETE",
] as const;
export const JOB_STATUSES = ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"] as const;

export type SourceKind = (typeof SOURCE_KINDS)[number];
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];
export type JobStatus = (typeof JOB_STATUSES)[number];

const rightsConfirmed = z.literal(true, {
  error: "Confirm that you own or have permission to process this material.",
});

export const CreateUploadSourceSchema = z.object({
  type: z.literal("upload"),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  sizeBytes: z.number().int().positive(),
  title: z.string().trim().max(200).optional(),
  // Measured client-side (HTMLMediaElement) to improve the estimate only.
  durationMs: z.number().int().positive().max(24 * 3600 * 1000).optional(),
  rightsConfirmed,
});

export const CreateYouTubeSourceSchema = z.object({
  type: z.literal("youtube"),
  url: z.url().max(500),
  title: z.string().trim().max(200).optional(),
  rightsConfirmed,
});

export const CreateSourceInputSchema = z.discriminatedUnion("type", [CreateUploadSourceSchema, CreateYouTubeSourceSchema]);
export type CreateSourceInput = z.infer<typeof CreateSourceInputSchema>;

export const EstimateSchema = z.object({ minSeconds: z.number(), maxSeconds: z.number() });

export const CreateSourceResponseSchema = z.object({
  sourceId: z.uuid(),
  kind: z.enum(SOURCE_KINDS),
  estimate: EstimateSchema,
  // Present for file uploads; absent for YouTube (processing starts at once).
  upload: z
    .object({
      url: z.url(),
      method: z.literal("PUT"),
      headers: z.record(z.string(), z.string()),
      expiresIn: z.number(),
    })
    .optional(),
});
export type CreateSourceResponse = z.infer<typeof CreateSourceResponseSchema>;

export const CompleteUploadResponseSchema = z.object({ sourceId: z.uuid(), jobId: z.uuid() });
export type CompleteUploadResponse = z.infer<typeof CompleteUploadResponseSchema>;

export const JobEventSchema = z.object({
  id: z.uuid(),
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]),
  stage: z.enum(PROCESSING_STAGES).nullable(),
  message: z.string(),
  createdAt: z.string(),
});

export const SourceStatusSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  kind: z.enum(SOURCE_KINDS),
  status: z.enum(SOURCE_STATUSES),
  sizeBytes: z.number().nullable(),
  durationMs: z.number().nullable(),
  pageCount: z.number().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  job: z
    .object({
      id: z.uuid(),
      status: z.enum(JOB_STATUSES),
      stage: z.enum(PROCESSING_STAGES).nullable(),
      progress: z.number(),
      startedAt: z.string().nullable(),
      finishedAt: z.string().nullable(),
      events: z.array(JobEventSchema),
    })
    .nullable(),
});
export type SourceStatusView = z.infer<typeof SourceStatusSchema>;

export const StudySetStatusResponseSchema = z.object({
  studySetId: z.uuid(),
  sources: z.array(SourceStatusSchema),
  active: z.boolean(),
});
export type StudySetStatusResponse = z.infer<typeof StudySetStatusResponseSchema>;

export const ActiveJobSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  status: z.enum(JOB_STATUSES),
  stage: z.enum(PROCESSING_STAGES).nullable(),
  progress: z.number(),
  studySetId: z.uuid(),
  studySetTitle: z.string(),
  sourceTitle: z.string().nullable(),
  error: z.string().nullable(),
  queuedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ActiveJob = z.infer<typeof ActiveJobSchema>;
export const ListJobsResponseSchema = z.object({ jobs: z.array(ActiveJobSchema) });
export type ListJobsResponse = z.infer<typeof ListJobsResponseSchema>;
