import { z } from "zod";
import { clientIp, json, parseBody, route } from "@/lib/api";
import { RegisterInputSchema } from "@/lib/contracts/auth";
import { requireAdmin } from "@/server/admin-auth";
import { requireProfile } from "@/server/services/profiles";
import { listAccounts, registerUser, type AccountView } from "@/server/services/users";

const CreateAccountSchema = RegisterInputSchema.extend({ profileId: z.uuid("Choose a profile.") });

export const GET = route(async (req) => {
  await requireAdmin(req);
  return json<{ accounts: AccountView[] }>({ accounts: await listAccounts() }, 200, { "Cache-Control": "no-store" });
});

/** Creates an account (name, email, password, profile) with its personal workspace. */
export const POST = route(async (req) => {
  await requireAdmin(req);
  const { profileId, ...input } = await parseBody(req, CreateAccountSchema);
  await requireProfile(profileId);
  const { id } = await registerUser(input, clientIp(req), { byAdmin: true, profileId });
  return json({ id, email: input.email }, 201);
});
