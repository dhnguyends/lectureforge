import { route } from "@/lib/api";
import { requireAdmin } from "@/server/admin-auth";
import { removeDiscipline } from "@/server/services/profiles";

export const DELETE = route<{ disciplineId: string }>(async (req, { params }) => {
  await requireAdmin(req);
  await removeDiscipline(params.disciplineId);
  return new Response(null, { status: 204 });
});
