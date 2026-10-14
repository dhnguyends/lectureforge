/**
 * Site-wide access password (LECTURE_ACCESS_KEY). Edge-safe: used by the
 * middleware, so only Web Crypto here.
 *
 * The cookie holds an HMAC of a fixed label keyed with the access key, never
 * the key itself. Changing the key invalidates every issued cookie.
 */
export const ACCESS_COOKIE = "lf_access";
export const ACCESS_COOKIE_MAX_AGE = 30 * 24 * 3600;
const LABEL = "lectureforge-access/v1";

/** The configured key, or null when the gate is off. */
export function accessKey(): string | null {
  const key = process.env.LECTURE_ACCESS_KEY?.trim();
  return key ? key : null;
}

export async function accessToken(key: string): Promise<string> {
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, enc.encode(LABEL)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Token the admin page (control service) sends to the app's /api/admin
 * routes. Derived from the access key with a different label, so it is
 * neither the key nor a valid access cookie.
 */
export async function adminApiToken(key: string): Promise<string> {
  const enc = new TextEncoder();
  const hmacKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, enc.encode("lectureforge-admin-api/v1")));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function hasAccess(cookieValue: string | undefined, key: string): Promise<boolean> {
  return Boolean(cookieValue) && safeEqual(cookieValue!, await accessToken(key));
}

/** Paths reachable without the access cookie: the unlock page and static assets. */
export function isGateExempt(path: string): boolean {
  return path === "/access" || path.startsWith("/_next/") || path === "/favicon.ico" || path === "/robots.txt";
}
