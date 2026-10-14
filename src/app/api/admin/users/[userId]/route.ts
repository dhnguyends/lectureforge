import { z } from "zod";
import { json, parseBody, route } from "@/lib/api";
import { requireAdmin } from "@/server/admin-auth";
import { requireProfile } from "@/server/services/profiles";
import { deleteAccount, setUserProfile } from "@/server/services/users";

/** Moves an account to another profile. */
export const PATCH = route<{ userId: string }>(async (req, { params }) => {
  await requireAdmin(req);
  const { profileId } = await parseBody(req, z.object({ profileId: z.uuid() }));
  await requireProfile(profileId);
  await setUserProfile(params.userId, profileId);
  return json({ ok: true });
});

/** Deletes the account, its study sets and its uploaded files. Cannot be undone. */
export const DELETE = route<{ userId: string }>(async (req, { params }) => {
  await requireAdmin(req);
  return json(await deleteAccount(params.userId));
});
