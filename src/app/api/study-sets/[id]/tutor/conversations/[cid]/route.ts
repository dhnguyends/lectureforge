import { json, route } from "@/lib/api";
import type { ConversationView } from "@/lib/contracts/tutor";
import { requireStudySet, requireUser } from "@/server/authz";
import { deleteConversation, getConversation, requireConversation, tutorModelName } from "@/server/tutor/service";

export const GET = route<{ id: string; cid: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  await requireConversation(user.id, params.id, params.cid);
  return json<ConversationView>(await getConversation(params.cid, tutorModelName()), 200, { "Cache-Control": "private, no-store" });
});

export const DELETE = route<{ id: string; cid: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  await requireConversation(user.id, params.id, params.cid);
  await deleteConversation(params.cid);
  return new Response(null, { status: 204 });
});
