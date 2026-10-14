import { clientIp, json, parseBody, route } from "@/lib/api";
import { CreateFlashcardsInputSchema, type FlashcardsOverview } from "@/lib/contracts/flashcards";
import { requireStudySet, requireUser } from "@/server/authz";
import { getFlashcardsOverview, requestFlashcards } from "@/server/services/flashcards";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<FlashcardsOverview>(await getFlashcardsOverview(user.id, params.id), 200, { "Cache-Control": "no-store" });
});

/** Queues generation of a new deck from the study set's sources. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id, "EDITOR");
  const input = await parseBody(req, CreateFlashcardsInputSchema);
  return json(await requestFlashcards({ id: user.id, ip: clientIp(req) }, set, input), 202);
});
