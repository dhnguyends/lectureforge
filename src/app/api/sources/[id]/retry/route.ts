import { clientIp, json, route } from "@/lib/api";
import { requireSource, requireUser } from "@/server/authz";
import { retrySource } from "@/server/services/sources";

/** Re-runs processing for a failed source, resuming finished transcription parts. */
export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id, "EDITOR");
  return json(await retrySource({ id: user.id, ip: clientIp(req) }, params.id), 202);
});
