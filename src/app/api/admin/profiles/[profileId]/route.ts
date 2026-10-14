import { route } from "@/lib/api";
import { requireAdmin } from "@/server/admin-auth";
import { deleteProfile } from "@/server/services/profiles";

/** Deletes a profile that no account uses (its disciplines go with it). */
export const DELETE = route<{ profileId: string }>(async (req, { params }) => {
  await requireAdmin(req);
  await deleteProfile(params.profileId);
  return new Response(null, { status: 204 });
});
