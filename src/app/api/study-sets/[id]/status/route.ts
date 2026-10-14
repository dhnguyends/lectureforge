import { json, route } from "@/lib/api";
import type { StudySetStatusResponse } from "@/lib/contracts/source";
import { requireStudySet, requireUser } from "@/server/authz";
import { getStudySetStatus } from "@/server/services/study-sets";

/** Polled by the processing dashboard while any source is in flight. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<StudySetStatusResponse>(await getStudySetStatus(params.id), 200, { "Cache-Control": "no-store" });
});
