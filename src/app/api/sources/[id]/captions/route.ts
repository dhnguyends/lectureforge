import { route } from "@/lib/api";
import { requireSource, requireUser } from "@/server/authz";
import { getCaptions } from "@/server/services/viewer";

/** WebVTT captions generated from the (corrected) transcript. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id);
  return new Response(await getCaptions(params.id), {
    headers: { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "private, no-store" },
  });
});
