import { json, route } from "@/lib/api";
import type { GuideView } from "@/lib/contracts/study-guide";
import { requireUser } from "@/server/authz";
import { deleteStudyGuide, getStudyGuide, requireGuide } from "@/server/services/study-guides";

export const GET = route<{ guideId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { guideId } = await requireGuide(user.id, params.guideId);
  return json<GuideView>(await getStudyGuide(guideId), 200, { "Cache-Control": "no-store" });
});

export const DELETE = route<{ guideId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { guideId } = await requireGuide(user.id, params.guideId, "EDITOR");
  await deleteStudyGuide(guideId);
  return new Response(null, { status: 204 });
});
