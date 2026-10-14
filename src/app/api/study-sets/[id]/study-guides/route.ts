import { clientIp, json, parseBody, route } from "@/lib/api";
import { CreateStudyGuideInputSchema, type StudyGuidesResponse } from "@/lib/contracts/study-guide";
import { requireStudySet, requireUser } from "@/server/authz";
import { listStudyGuides, requestStudyGuide } from "@/server/services/study-guides";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<StudyGuidesResponse>(await listStudyGuides(params.id), 200, { "Cache-Control": "no-store" });
});

/** Queues generation of a new study guide (a new version; earlier guides are kept). */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id, "EDITOR");
  const { style } = await parseBody(req, CreateStudyGuideInputSchema);
  return json(await requestStudyGuide({ id: user.id, ip: clientIp(req) }, set, style), 202);
});
