import { json, route } from "@/lib/api";
import type { ReviewQueue } from "@/lib/contracts/flashcards";
import { requireStudySet, requireUser } from "@/server/authz";
import { getReviewQueue } from "@/server/services/flashcards";

/** The cards this learner should review now (due first, then today's new cards). */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<ReviewQueue>(await getReviewQueue(user.id, params.id), 200, { "Cache-Control": "no-store" });
});
