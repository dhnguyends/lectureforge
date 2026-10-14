import { clientIp, json, parseBody, route } from "@/lib/api";
import { RegenerateSectionInputSchema } from "@/lib/contracts/study-guide";
import { requireUser } from "@/server/authz";
import { requestSectionRegeneration, requireSection } from "@/server/services/study-guides";

/** Regenerates one section. Returns 409 has_user_edits unless `force` is set. */
export const POST = route<{ sectionId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { section, set } = await requireSection(user.id, params.sectionId, "EDITOR");
  const input = await parseBody(req, RegenerateSectionInputSchema);
  return json(await requestSectionRegeneration({ id: user.id, ip: clientIp(req) }, section, set.id, input), 202);
});
