import { clientIp, json, route } from "@/lib/api";
import { requireStudySet, requireUser } from "@/server/authz";
import { deleteStudySet } from "@/server/services/study-sets";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id);
  return json({
    id: set.id,
    title: set.title,
    course: set.course,
    subject: set.subject,
    learnerLevel: set.learnerLevel,
    examDate: set.examDate?.toISOString().slice(0, 10) ?? null,
    language: set.language,
    outputTypes: set.outputTypes,
    role: set.role,
  });
});

/** Permanent deletion of the study set, its sources, and everything generated from them. */
export const DELETE = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id, "OWNER");
  await deleteStudySet({ id: user.id, ip: clientIp(req) }, set);
  return new Response(null, { status: 204 });
});
