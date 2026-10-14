import { notFound } from "next/navigation";
import { cache } from "react";
import { auth } from "@/auth";
import { HttpError } from "@/lib/errors";
import { requireStudySet } from "@/server/authz";

/** Loads the study set for a page/layout, mapping access failures to 404. Cached per request. */
export const loadStudySet = cache(async (id: string) => {
  const session = await auth();
  if (!session?.user?.id) notFound();
  try {
    return await requireStudySet(session.user.id, id);
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) notFound();
    throw err;
  }
});
