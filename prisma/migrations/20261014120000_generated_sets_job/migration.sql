-- Link generated flashcard decks, quizzes and exercise sets to the job that
-- produced them, so a retried job can replace its own partial output.
ALTER TABLE "FlashcardDeck" ADD COLUMN "generationJobId" UUID;
ALTER TABLE "Quiz" ADD COLUMN "generationJobId" UUID;
ALTER TABLE "ExerciseSet" ADD COLUMN "generationJobId" UUID;
