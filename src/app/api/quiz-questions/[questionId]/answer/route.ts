import { json, parseBody, route } from "@/lib/api";
import { AnswerQuestionInputSchema, type AnswerResult } from "@/lib/contracts/quiz";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requireUser } from "@/server/authz";
import { answerQuestion, requireQuiz } from "@/server/services/quizzes";

/** Grades an answer within an attempt and returns the correct answer, explanation and sources. */
export const POST = route<{ questionId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const question = await db.quizQuestion.findUnique({ where: { id: params.questionId }, select: { quizId: true } }).catch(() => null);
  if (!question) throw notFound("Question");
  const { set } = await requireQuiz(user.id, question.quizId);
  const input = await parseBody(req, AnswerQuestionInputSchema);
  return json<AnswerResult>(await answerQuestion(user.id, params.questionId, input, set.language));
});
