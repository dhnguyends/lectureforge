-- A quiz run is a StudySession (activity QUIZ) pointing at its quiz.
ALTER TABLE "StudySession" ADD COLUMN "quizId" UUID;
CREATE INDEX "StudySession_quizId_userId_idx" ON "StudySession"("quizId", "userId");
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
