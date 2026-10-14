import { describe, expect, it } from "vitest";
import { accessToken, hasAccess, isGateExempt, safeEqual } from "@/lib/access-gate";

describe("access gate", () => {
  it("derives a stable token that does not reveal the key", async () => {
    const a = await accessToken("correct horse battery staple");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(await accessToken("correct horse battery staple"));
    expect(a).not.toContain("horse");
    expect(await accessToken("another key")).not.toBe(a);
  });

  it("accepts only the cookie issued for the current key", async () => {
    const cookie = await accessToken("k1-secret");
    expect(await hasAccess(cookie, "k1-secret")).toBe(true);
    expect(await hasAccess(cookie, "rotated-key")).toBe(false);
    expect(await hasAccess(undefined, "k1-secret")).toBe(false);
    expect(await hasAccess("k1-secret", "k1-secret")).toBe(false); // the raw key is not a valid cookie
  });

  it("compares strings exactly", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("only exempts the unlock page and static assets", () => {
    expect(isGateExempt("/access")).toBe(true);
    expect(isGateExempt("/_next/static/chunks/app.js")).toBe(true);
    expect(isGateExempt("/")).toBe(false);
    expect(isGateExempt("/sign-in")).toBe(false);
    expect(isGateExempt("/api/auth/session")).toBe(false);
    expect(isGateExempt("/access-other")).toBe(false);
  });
});
