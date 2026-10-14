import { json, route } from "@/lib/api";
import { notFound } from "@/lib/errors";
import type { TranscriptView } from "@/lib/contracts/viewer";
import { requireSource, requireUser } from "@/server/authz";
import { getTranscript } from "@/server/services/viewer";

export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id);
  const transcript = await getTranscript(params.id);
  if (!transcript) throw notFound("Transcript");
  return json<TranscriptView>(transcript, 200, { "Cache-Control": "private, no-store" });
});
