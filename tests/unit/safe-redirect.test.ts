import { describe, expect, it } from "vitest";
import { safeCallbackPath } from "@/lib/safe-redirect";

describe("safeCallbackPath", () => {
  it("keeps same-site paths, including from absolute Auth.js callback URLs", () => {
    expect(safeCallbackPath("/study-sets/abc?tab=quiz")).toBe("/study-sets/abc?tab=quiz");
    expect(safeCallbackPath("http://localhost:3000/study-sets/abc")).toBe("/study-sets/abc");
  });

  it("never yields an off-site redirect", () => {
    // Host is discarded; only the path survives.
    expect(safeCallbackPath("https://evil.example/phish")).toBe("/phish");
    expect(safeCallbackPath("//evil.example/x")).toBe("/x");
    expect(safeCallbackPath("/\\evil.example")).not.toMatch(/^\/\//);
  });

  it("falls back for empty, non-string, or auth-page targets", () => {
    expect(safeCallbackPath("")).toBe("/dashboard");
    expect(safeCallbackPath(null)).toBe("/dashboard");
    expect(safeCallbackPath("/sign-in")).toBe("/dashboard");
  });
});
