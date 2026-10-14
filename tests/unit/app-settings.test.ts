import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, readAppSettings } from "@/lib/app-settings";

describe("app settings", () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lf-settings-"));
    process.env.APP_SETTINGS_PATH = join(dir, "settings.json");
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults to Sonnet with medium effort", () => {
    expect(DEFAULT_SETTINGS).toEqual({ aiModel: "claude-sonnet-5-5", aiEffort: "medium" });
    expect(readAppSettings()).toEqual(DEFAULT_SETTINGS); // no file yet
  });

  it("accepts only the allowed models and efforts", () => {
    expect(parseSettings({ aiModel: "claude-opus-5-5", aiEffort: "high" })).toEqual({ aiModel: "claude-opus-5-5", aiEffort: "high" });
    expect(parseSettings({ aiModel: "gpt-x", aiEffort: "max" })).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("nonsense")).toEqual(DEFAULT_SETTINGS);
  });

  it("re-reads the file when it changes and survives a corrupt file", () => {
    const file = process.env.APP_SETTINGS_PATH!;
    writeFileSync(file, JSON.stringify({ aiModel: "claude-opus-5-5", aiEffort: "high" }));
    expect(readAppSettings().aiModel).toBe("claude-opus-5-5");
    writeFileSync(file, JSON.stringify({ aiModel: "claude-sonnet-5-5", aiEffort: "high" }));
    const later = new Date(Date.now() + 5000);
    utimesSync(file, later, later); // make the change visible even within the same millisecond
    expect(readAppSettings()).toEqual({ aiModel: "claude-sonnet-5-5", aiEffort: "high" });
    writeFileSync(file, "{ not json");
    utimesSync(file, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000));
    expect(readAppSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("is what the Claude client uses", async () => {
    vi.resetModules();
    writeFileSync(process.env.APP_SETTINGS_PATH!, JSON.stringify({ aiModel: "claude-opus-5-5", aiEffort: "high" }));
    Object.assign(process.env, { DATABASE_URL: "postgresql://x:y@localhost:5432/z", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s", ANTHROPIC_API_KEY: "sk-ant-test", AI_PROVIDER: "anthropic" });
    const ai = await import("@/server/ai");
    const model = ai.getChatModel() as unknown as { model: string; effort: string };
    expect(model.model).toBe("claude-opus-5-5");
    expect(model.effort).toBe("high");
  });
});
