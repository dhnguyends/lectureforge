import type { GenerationJob } from "@prisma/client";
import { PipelineError } from "@/server/pipeline/errors";
import { registerGenerator, type GenerationContext } from "./registry";
import { generateExercises, type ExercisesPayload } from "./exercises/generate";
import { generateFlashcards, type FlashcardsPayload } from "./flashcards/generate";
import { generateQuiz, type QuizPayload } from "./quiz/generate";
import { generateStudyGuide, regenerateStudyGuideSection, type RegenerateSectionPayload } from "./study-guide/generate";

registerGenerator("GENERATE_STUDY_GUIDE", generateStudyGuide);
registerGenerator("GENERATE_FLASHCARDS", generateFlashcards);
registerGenerator("GENERATE_QUIZ", generateQuiz);
registerGenerator("GENERATE_EXERCISES", generateExercises);

// REGENERATE_ITEM dispatches on the kind of item being regenerated.
registerGenerator("REGENERATE_ITEM", (job: GenerationJob, ctx: GenerationContext) => {
  const payload = job.payload as { entityType?: string } | null;
  switch (payload?.entityType) {
    case "StudyGuideSection":
      return regenerateStudyGuideSection(job, ctx);
    default:
      throw new PipelineError(`Regenerating ${payload?.entityType ?? "this item"} is not supported yet.`);
  }
});

export { hasGenerator } from "./registry";
export type { ExercisesPayload, FlashcardsPayload, QuizPayload, RegenerateSectionPayload };
