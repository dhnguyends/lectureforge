import { json, route } from "@/lib/api";
import type { SourceCitationView } from "@/lib/contracts/viewer";
import { requireSource, requireUser } from "@/server/authz";
import { citationsForSource } from "@/server/services/viewer";

/** Study-guide statements that cite this source. */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  await requireSource(user.id, params.id);
  return json<{ citations: SourceCitationView[] }>({ citations: await citationsForSource(params.id) }, 200, { "Cache-Control": "private, no-store" });
});
