import { json, route } from "@/lib/api";
import type { CardsResponse } from "@/lib/contracts/flashcards";
import { requireStudySet, requireUser } from "@/server/authz";
import { listCards } from "@/server/services/flashcards";

const UUID = /^[0-9a-f-]{36}$/i;

export const GET = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  const deckId = req.nextUrl.searchParams.get("deckId") ?? undefined;
  return json<CardsResponse>({ cards: await listCards(user.id, params.id, deckId && UUID.test(deckId) ? deckId : undefined) }, 200, { "Cache-Control": "no-store" });
});
