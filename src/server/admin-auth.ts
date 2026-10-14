import type { NextRequest } from "next/server";
import { accessKey, adminApiToken, safeEqual } from "@/lib/access-gate";
import { notFound, unauthorized } from "@/lib/errors";

/**
 * Guards the /api/admin routes. They are called server-to-server by the
 * control service (control/server.mjs) after its own admin sign-in, with a
 * token derived from LECTURE_ACCESS_KEY; a browser session cannot use them.
 */
export async function requireAdmin(req: NextRequest): Promise<void> {
  const key = accessKey();
  if (!key) throw notFound("Page");
  if (!safeEqual(req.headers.get("x-admin-token") ?? "", await adminApiToken(key))) throw unauthorized();
}
