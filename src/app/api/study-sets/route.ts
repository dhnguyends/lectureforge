import { clientIp, json, parseBody, route } from "@/lib/api";
import {
  CreateStudySetInputSchema,
  type CreateStudySetResponse,
  type ListStudySetsResponse,
} from "@/lib/contracts/study-set";
import { requireUser } from "@/server/authz";
import { createStudySet, listStudySets } from "@/server/services/study-sets";

export const GET = route(async () => {
  const user = await requireUser();
  return json<ListStudySetsResponse>({ studySets: await listStudySets(user.id) });
});

export const POST = route(async (req) => {
  const user = await requireUser();
  const input = await parseBody(req, CreateStudySetInputSchema);
  const created = await createStudySet({ id: user.id, ip: clientIp(req) }, input);
  return json<CreateStudySetResponse>(created, 201);
});
