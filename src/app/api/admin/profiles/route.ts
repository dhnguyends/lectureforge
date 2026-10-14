import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { requireAdmin } from "@/server/admin-auth";
import { createProfile, listProfiles, type ProfileView } from "@/server/services/profiles";

export const GET = route(async (req) => {
  await requireAdmin(req);
  return json<{ profiles: ProfileView[] }>({ profiles: await listProfiles() }, 200, { "Cache-Control": "no-store" });
});

export const POST = route(async (req) => {
  await requireAdmin(req);
  const input = await parseBody(req, z.object({ name: z.string().trim().min(2).max(80), anyDiscipline: z.boolean().default(false) }));
  return json(await createProfile(input), 201);
});
