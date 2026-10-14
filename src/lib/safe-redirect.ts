/**
 * Reduces any post-sign-in callback (Auth.js passes absolute URLs) to a path
 * on this site, so a crafted link can never redirect off-site.
 */
export function safeCallbackPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    const url = new URL(raw, "http://internal.invalid");
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/sign-")) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
