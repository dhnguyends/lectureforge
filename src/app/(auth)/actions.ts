"use server";

import { AuthError } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { ACCESS_COOKIE, ACCESS_COOKIE_MAX_AGE, accessKey, accessToken, safeEqual } from "@/lib/access-gate";
import { enforceRateLimit } from "@/lib/rate-limit";
import { oauthProviderIds, signIn } from "@/auth";
import { SignInInputSchema } from "@/lib/contracts/auth";
import { HttpError } from "@/lib/errors";
import { safeCallbackPath } from "@/lib/safe-redirect";

export type AuthFormState = { error?: string } | undefined;

export async function signInAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const parsed = SignInInputSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: safeCallbackPath(form.get("callbackUrl")) });
  } catch (err) {
    if (err instanceof AuthError) return { error: "Email or password is incorrect." };
    throw err; // includes the redirect signal thrown on success
  }
}

export async function oauthSignInAction(form: FormData): Promise<void> {
  const provider = String(form.get("provider"));
  if (!oauthProviderIds.includes(provider)) return;
  await signIn(provider, { redirectTo: "/dashboard" });
}

/** Checks the site access password (LECTURE_ACCESS_KEY) and sets the access cookie. */
export async function unlockAction(_prev: AuthFormState, form: FormData): Promise<AuthFormState> {
  const key = accessKey();
  const next = safeCallbackPath(form.get("next"), "/");
  if (!key) redirect(next);

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  try {
    await enforceRateLimit("access", ip);
  } catch (err) {
    if (err instanceof HttpError) return { error: "Too many attempts. Wait a few minutes and try again." };
    throw err;
  }
  const given = String(form.get("password") ?? "");
  if (!safeEqual(given, key)) return { error: "That password is not correct." };

  (await cookies()).set(ACCESS_COOKIE, await accessToken(key), {
    httpOnly: true,
    sameSite: "lax",
    secure: (h.get("x-forwarded-proto") ?? new URL(process.env.APP_URL ?? "http://localhost").protocol.replace(":", "")) === "https",
    path: "/",
    maxAge: ACCESS_COOKIE_MAX_AGE,
  });
  redirect(next);
}
