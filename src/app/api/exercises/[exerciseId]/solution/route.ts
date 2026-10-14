import { json, parseBody, route } from "@/lib/api";
import { RevealSolutionInputSchema, type SolutionView } from "@/lib/contracts/exercises";
import { requireUser } from "@/server/authz";
import { requireExercise, revealSolution } from "@/server/services/exercises";

/** Reveals the worked solution, rubric and sources (recorded for this learner). */
export const POST = route<{ exerciseId: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireExercise(user.id, params.exerciseId);
  const { hintsUsed } = await parseBody(req, RevealSolutionInputSchema);
  return json<SolutionView>(await revealSolution(user.id, params.exerciseId, hintsUsed));
});
