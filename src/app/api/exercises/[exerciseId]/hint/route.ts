import { json, parseBody, route } from "@/lib/api";
import { HintInputSchema } from "@/lib/contracts/exercises";
import { requireUser } from "@/server/authz";
import { getHint, requireExercise } from "@/server/services/exercises";

/** The next hint (hints are revealed one at a time; the count is recorded with the answer). */
export const POST = route<{ exerciseId: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireExercise(user.id, params.exerciseId);
  const { index } = await parseBody(req, HintInputSchema);
  return json(await getHint(params.exerciseId, index));
});
