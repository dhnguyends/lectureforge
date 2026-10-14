import { json, route } from "@/lib/api";
import type { MediaView } from "@/lib/contracts/viewer";
import { db } from "@/lib/db";
import { requireSource, requireUser } from "@/server/authz";
import { getMedia } from "@/server/services/viewer";

/** Short-lived signed URLs for playing or viewing a source. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id);
  const source = await db.source.findUniqueOrThrow({ where: { id: params.id }, include: { assets: true } });
  return json<MediaView>(await getMedia(source), 200, { "Cache-Control": "private, no-store" });
});
