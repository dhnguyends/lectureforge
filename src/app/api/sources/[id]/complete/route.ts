import { clientIp, json, route } from "@/lib/api";
import type { CompleteUploadResponse } from "@/lib/contracts/source";
import { requireSource, requireUser } from "@/server/authz";
import { completeUpload } from "@/server/services/sources";

export const POST = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id, "EDITOR");
  return json<CompleteUploadResponse>(await completeUpload({ id: user.id, ip: clientIp(req) }, params.id));
});
