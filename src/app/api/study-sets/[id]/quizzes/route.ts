import { clientIp, json, parseBody, route } from "@/lib/api";
import { CreateQuizInputSchema, type QuizzesOverview } from "@/lib/contracts/quiz";
import { requireStudySet, requireUser } from "@/server/authz";
import { listQuizzes, requestQuiz } from "@/server/services/quizzes";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<QuizzesOverview>(await listQuizzes(user.id, params.id), 200, { "Cache-Control": "no-store" });
});

/** Queues generation of a new quiz from the study set's sources. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id, "EDITOR");
  const input = await parseBody(req, CreateQuizInputSchema);
  return json(await requestQuiz({ id: user.id, ip: clientIp(req) }, set, input), 202);
});
