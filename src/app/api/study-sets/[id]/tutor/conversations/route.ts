import { json, parseBody, route } from "@/lib/api";
import { CreateConversationSchema, type ConversationSummary } from "@/lib/contracts/tutor";
import { requireStudySet, requireUser } from "@/server/authz";
import { createConversation, listConversations } from "@/server/tutor/service";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  return json<{ conversations: ConversationSummary[] }>({ conversations: await listConversations(params.id, user.id) }, 200, {
    "Cache-Control": "private, no-store",
  });
});

export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  const { title } = await parseBody(req, CreateConversationSchema);
  const c = await createConversation(params.id, user.id, title);
  return json({ id: c.id }, 201);
});
