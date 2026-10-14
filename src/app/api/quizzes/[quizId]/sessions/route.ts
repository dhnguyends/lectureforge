import { json, route } from "@/lib/api";
import { requireUser } from "@/server/authz";
import { requireQuiz, startSession } from "@/server/services/quizzes";

/** Starts a new attempt at the quiz (closing any unfinished one). */
export const POST = route<{ quizId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { quizId, set } = await requireQuiz(user.id, params.quizId);
  return json(await startSession(user.id, quizId, set.id), 201);
});
