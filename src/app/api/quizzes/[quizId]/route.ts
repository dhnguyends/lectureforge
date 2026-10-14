import { json, route } from "@/lib/api";
import type { QuizView } from "@/lib/contracts/quiz";
import { requireUser } from "@/server/authz";
import { deleteQuiz, getQuiz, requireQuiz } from "@/server/services/quizzes";

/** Questions without answers, plus the learner's unfinished attempt. */
export const GET = route<{ quizId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { quizId } = await requireQuiz(user.id, params.quizId);
  return json<QuizView>(await getQuiz(user.id, quizId), 200, { "Cache-Control": "no-store" });
});

export const DELETE = route<{ quizId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { quizId } = await requireQuiz(user.id, params.quizId, "EDITOR");
  await deleteQuiz(quizId);
  return new Response(null, { status: 204 });
});
