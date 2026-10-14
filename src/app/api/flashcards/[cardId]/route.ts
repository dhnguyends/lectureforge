import { json, parseBody, route } from "@/lib/api";
import { EditCardInputSchema, type CardView } from "@/lib/contracts/flashcards";
import { requireUser } from "@/server/authz";
import { deleteCard, editCard, requireCard } from "@/server/services/flashcards";

/** Edit a card's text or suspend it (suspended cards are never scheduled). */
export const PATCH = route<{ cardId: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireCard(user.id, params.cardId, "EDITOR");
  const input = await parseBody(req, EditCardInputSchema);
  return json<CardView>(await editCard(user.id, params.cardId, input));
});

export const DELETE = route<{ cardId: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireCard(user.id, params.cardId, "EDITOR");
  await deleteCard(params.cardId);
  return new Response(null, { status: 204 });
});
