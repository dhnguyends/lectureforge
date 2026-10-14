import { clientIp, json, parseBody, route } from "@/lib/api";
import { CreateExercisesInputSchema, type ExercisesOverview } from "@/lib/contracts/exercises";
import { requireStudySet, requireUser } from "@/server/authz";
import { listExerciseSets, requestExercises } from "@/server/services/exercises";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<ExercisesOverview>(await listExerciseSets(user.id, params.id), 200, { "Cache-Control": "no-store" });
});

/** Queues a new exercise set: { easy, intermediate, difficult } counts (default 5 / 5 / 2) and an optional focus. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id, "EDITOR");
  const input = await parseBody(req, CreateExercisesInputSchema);
  return json(await requestExercises({ id: user.id, ip: clientIp(req) }, set, input), 202);
});
