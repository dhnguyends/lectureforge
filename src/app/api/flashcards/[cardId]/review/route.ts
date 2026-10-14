import { json, parseBody, route } from "@/lib/api";
import { ReviewCardInputSchema, type ReviewResult } from "@/lib/contracts/flashcards";
import { requireUser } from "@/server/authz";
import { requireCard, reviewCard } from "@/server/services/flashcards";

/** Records an answer (Again / Hard / Good / Easy) and reschedules the card for this learner. */
export const POST = route<{ cardId: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireCard(user.id, params.cardId);
  const { rating, durationMs } = await parseBody(req, ReviewCardInputSchema);
  return json<ReviewResult>(await reviewCard(user.id, params.cardId, rating, durationMs));
});
