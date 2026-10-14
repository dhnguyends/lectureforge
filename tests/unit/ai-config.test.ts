import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The app must only use explicitly configured AI credentials. Developer tools
 * (and some hosts) export ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL into child
 * processes; those must never be adopted silently.
 */
const BASE_ENV = {
  DATABASE_URL: "postgresql://x:y@localhost:5432/z",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
};

describe("AI credential configuration", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...BASE_ENV, ANTHROPIC_AUTH_TOKEN: "ambient-token", ANTHROPIC_BASE_URL: "https://ambient.invalid" } as unknown as NodeJS.ProcessEnv;
  });
  afterEach(() => {
    process.env = saved;
  });

  it("is not configured by ambient tokens alone", async () => {
    const ai = await import("@/server/ai");
    expect(ai.isAiConfigured()).toBe(false);
    expect(() => ai.getChatModel()).toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("treats an empty key as unset", async () => {
    process.env.ANTHROPIC_API_KEY = "  ";
    const ai = await import("@/server/ai");
    expect(ai.isAiConfigured()).toBe(false);
  });

  it("uses the explicit key and ignores the ambient token and base URL", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const ai = await import("@/server/ai");
    expect(ai.isAiConfigured()).toBe(true);
    const model = ai.getChatModel() as unknown as { client: { apiKey: string; authToken: string | null; baseURL: string } };
    expect(model.client.apiKey).toBe("sk-ant-test");
    expect(model.client.authToken).toBeNull();
    expect(model.client.baseURL).toBe("https://api.anthropic.com");
  });
});
