import { json, route } from "@/lib/api";
import type { SessionSummary } from "@/lib/contracts/quiz";
import { requireUser } from "@/server/authz";
import { finishSession } from "@/server/services/quizzes";

/** Ends an attempt and returns its score, with a breakdown by topic. */
export const POST = route<{ sessionId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  return json<SessionSummary>(await finishSession(user.id, params.sessionId));
});
