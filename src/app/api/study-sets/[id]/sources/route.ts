import { clientIp, json, parseBody, route } from "@/lib/api";
import { CreateSourceInputSchema, type CreateSourceResponse } from "@/lib/contracts/source";
import { requireStudySet, requireUser } from "@/server/authz";
import { createSource } from "@/server/services/sources";

/**
 * Registers a source. For files, returns a presigned PUT URL; the client
 * uploads directly to object storage and then calls
 * POST /api/sources/:id/complete. For YouTube, processing is queued at once.
 */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const set = await requireStudySet(user.id, params.id, "EDITOR");
  const input = await parseBody(req, CreateSourceInputSchema);
  const result = await createSource({ id: user.id, ip: clientIp(req) }, set, input);
  return json<CreateSourceResponse>(result, 201);
});
