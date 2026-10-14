import { json, parseBody, route } from "@/lib/api";
import { SubmitExerciseInputSchema, type SubmissionResult } from "@/lib/contracts/exercises";
import { requireUser } from "@/server/authz";
import { requireExercise, submitAnswer } from "@/server/services/exercises";

/** Grades an answer against the exercise's rubric and reference solution. Answers can be resubmitted. */
export const POST = route<{ exerciseId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { set } = await requireExercise(user.id, params.exerciseId);
  const input = await parseBody(req, SubmitExerciseInputSchema);
  return json<SubmissionResult>(await submitAnswer(user.id, params.exerciseId, input, set.language));
});
