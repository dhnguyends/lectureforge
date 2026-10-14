import { json, parseBody, route } from "@/lib/api";
import { PatchSegmentSchema, type SegmentView } from "@/lib/contracts/viewer";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { requireSource, requireUser } from "@/server/authz";
import { patchSegment } from "@/server/services/viewer";

/** Correct, revert, or flag one transcript line. Triggers a debounced re-index. */
export const PATCH = route<{ segmentId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const seg = await db.transcriptSegment
    .findUnique({ where: { id: params.segmentId }, select: { transcript: { select: { sourceId: true } } } })
    .catch(() => null);
  if (!seg) throw notFound("Transcript line");
  await requireSource(user.id, seg.transcript.sourceId, "EDITOR");
  const input = await parseBody(req, PatchSegmentSchema);
  return json<SegmentView>(await patchSegment(user.id, params.segmentId, input));
});
