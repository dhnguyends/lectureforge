import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { requireAdmin } from "@/server/admin-auth";
import { addDiscipline } from "@/server/services/profiles";

export const POST = route<{ profileId: string }>(async (req, { params }) => {
  await requireAdmin(req);
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(2).max(120) }));
  return json(await addDiscipline(params.profileId, name), 201);
});
