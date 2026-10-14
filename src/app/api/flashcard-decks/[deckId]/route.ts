import { route } from "@/lib/api";
import { requireUser } from "@/server/authz";
import { deleteDeck } from "@/server/services/flashcards";

export const DELETE = route<{ deckId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await deleteDeck(user.id, params.deckId);
  return new Response(null, { status: 204 });
});
