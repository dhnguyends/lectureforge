import { json, route } from "@/lib/api";
import type { ExerciseSetView } from "@/lib/contracts/exercises";
import { requireUser } from "@/server/authz";
import { deleteExerciseSet, getExerciseSet, requireExerciseSet } from "@/server/services/exercises";

/** Exercises with this learner's progress; hints and solutions only as far as already opened. */
export const GET = route<{ setId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { exerciseSetId } = await requireExerciseSet(user.id, params.setId);
  return json<ExerciseSetView>(await getExerciseSet(user.id, exerciseSetId), 200, { "Cache-Control": "no-store" });
});

export const DELETE = route<{ setId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { exerciseSetId } = await requireExerciseSet(user.id, params.setId, "EDITOR");
  await deleteExerciseSet(exerciseSetId);
  return new Response(null, { status: 204 });
});
