import { z } from "zod";

export const LEARNER_LEVELS = ["UNDERGRADUATE", "ADVANCED_UNDERGRADUATE", "GRADUATE", "RESEARCH"] as const;
export const OUTPUT_TYPES = ["STUDY_GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES", "AUDIO_RECAP", "TUTOR"] as const;
export const DETAIL_LEVELS = ["CONCISE", "STANDARD", "EXHAUSTIVE"] as const;
export const CITATION_STRICTNESS = ["STRICT", "BALANCED", "LENIENT"] as const;

export type OutputType = (typeof OUTPUT_TYPES)[number];

/** BCP-47-ish language tag: "en", "de", "pt-BR". */
const languageTag = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, "Use a language code such as en or pt-BR");

export const AdvancedSettingsSchema = z.object({
  transcriptLanguage: languageTag.nullable().default(null),
  speakerDiarization: z.boolean().default(true),
  preserveEquationsCode: z.boolean().default(true),
  detailLevel: z.enum(DETAIL_LEVELS).default("STANDARD"),
  citationStrictness: z.enum(CITATION_STRICTNESS).default("STRICT"),
  sourcesOnly: z.boolean().default(true),
  allowExternalKnowledge: z.boolean().default(false),
});

export const CreateStudySetInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the study set a title").max(160),
    course: z.string().trim().max(120).optional(),
    subject: z.string().trim().max(120).optional(),
    description: z.string().trim().max(2000).optional(),
    learnerLevel: z.enum(LEARNER_LEVELS).default("ADVANCED_UNDERGRADUATE"),
    examDate: z.iso.date().optional(),
    language: languageTag.default("en"),
    outputTypes: z.array(z.enum(OUTPUT_TYPES)).max(OUTPUT_TYPES.length).default(["STUDY_GUIDE", "FLASHCARDS", "QUIZ"]),
    advanced: AdvancedSettingsSchema.default(AdvancedSettingsSchema.parse({})),
  })
  .refine((v) => !(v.advanced.sourcesOnly && v.advanced.allowExternalKnowledge), {
    message: "“Generate only from sources” and “Include external knowledge” cannot both be on.",
    path: ["advanced", "allowExternalKnowledge"],
  });

export type CreateStudySetInput = z.input<typeof CreateStudySetInputSchema>;
export type CreateStudySetParsed = z.output<typeof CreateStudySetInputSchema>;

export const StudySetSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  course: z.string().nullable(),
  subject: z.string().nullable(),
  learnerLevel: z.enum(LEARNER_LEVELS),
  examDate: z.string().nullable(),
  outputTypes: z.array(z.enum(OUTPUT_TYPES)),
  sourceCounts: z.object({ total: z.number(), ready: z.number(), processing: z.number(), failed: z.number() }),
  dueCards: z.number(),
  updatedAt: z.string(),
});
export type StudySetSummary = z.infer<typeof StudySetSummarySchema>;

export const CreateStudySetResponseSchema = z.object({ id: z.uuid() });
export type CreateStudySetResponse = z.infer<typeof CreateStudySetResponseSchema>;

export const ListStudySetsResponseSchema = z.object({ studySets: z.array(StudySetSummarySchema) });
export type ListStudySetsResponse = z.infer<typeof ListStudySetsResponseSchema>;
