import NextAuth from "next-auth";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { ACCESS_COOKIE, accessKey, hasAccess, isGateExempt } from "@/lib/access-gate";
import authConfig from "./auth.config";

const { auth } = NextAuth(authConfig);
const authMiddleware = auth as unknown as (req: NextRequest, ev: NextFetchEvent) => Promise<Response | undefined>;

export async function middleware(req: NextRequest, ev: NextFetchEvent) {
  const path = req.nextUrl.pathname;
  const key = accessKey();

  // Site-wide access password: checked before anything else, API included.
  if (key && !isGateExempt(path) && !(await hasAccess(req.cookies.get(ACCESS_COOKIE)?.value, key))) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: { code: "access_required", message: "Enter the site access password first." } }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/access";
    url.search = "";
    if (path !== "/") url.searchParams.set("next", `${path}${req.nextUrl.search}`);
    return NextResponse.redirect(url);
  }

  // API routes enforce sign-in themselves (JSON 401s, not redirects).
  if (path.startsWith("/api/")) return NextResponse.next();
  return authMiddleware(req, ev);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)"],
};
