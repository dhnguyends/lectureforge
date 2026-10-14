import { clientIp, json, parseBody, route } from "@/lib/api";
import { EditSectionInputSchema } from "@/lib/contracts/study-guide";
import { requireUser } from "@/server/authz";
import { editSection, requireSection } from "@/server/services/study-guides";

/** Manual edit; saved as a new version. */
export const PATCH = route<{ sectionId: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { section, set } = await requireSection(user.id, params.sectionId, "EDITOR");
  const input = await parseBody(req, EditSectionInputSchema);
  await editSection({ id: user.id, ip: clientIp(req) }, section.id, set.id, input);
  return json({ ok: true });
});
