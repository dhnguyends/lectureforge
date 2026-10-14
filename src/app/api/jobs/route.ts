import { json, route } from "@/lib/api";
import type { ListJobsResponse } from "@/lib/contracts/source";
import { requireUser } from "@/server/authz";
import { listRecentJobs } from "@/server/services/dashboard";

export const GET = route(async () => {
  const user = await requireUser();
  return json<ListJobsResponse>({ jobs: await listRecentJobs(user.id) }, 200, { "Cache-Control": "no-store" });
});
