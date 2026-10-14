import { clientIp, route } from "@/lib/api";
import { requireSource, requireUser } from "@/server/authz";
import { deleteSource } from "@/server/services/sources";

/** Permanently deletes a source, its transcript, chunks and stored files. */
export const DELETE = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { studySet } = await requireSource(user.id, params.id, "EDITOR");
  await deleteSource({ id: user.id, ip: clientIp(req) }, params.id, studySet);
  return new Response(null, { status: 204 });
});
