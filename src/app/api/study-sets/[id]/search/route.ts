import { json, route } from "@/lib/api";
import type { SearchResultView } from "@/lib/contracts/viewer";
import { requireStudySet, requireUser } from "@/server/authz";
import { searchStudySet } from "@/server/services/viewer";

/** Hybrid (keyword + semantic) search across every source in the study set. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  await requireStudySet(user.id, params.id);
  const q = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 300);
  return json<{ query: string; results: SearchResultView[] }>({ query: q, results: await searchStudySet(params.id, q) }, 200, { "Cache-Control": "private, no-store" });
});
