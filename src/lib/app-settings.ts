import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Settings an administrator changes at runtime on the admin page (served by
 * the control service, control/server.mjs). Stored as a small JSON file so it
 * works while the rest of the stack is stopped; the web app and the worker
 * re-read it whenever it changes, so a new value applies to the next
 * generation without a restart.
 */

export const AI_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
export const AI_EFFORTS = ["medium", "high"] as const;
export type AiModelSetting = (typeof AI_MODELS)[number];
export type AiEffortSetting = (typeof AI_EFFORTS)[number];

export type AppSettings = { aiModel: AiModelSetting; aiEffort: AiEffortSetting };

export const DEFAULT_SETTINGS: AppSettings = { aiModel: "claude-sonnet-5-5", aiEffort: "medium" };

export function settingsPath(): string {
  return process.env.APP_SETTINGS_PATH || join(process.cwd(), ".data", "settings.json");
}

/** Keeps known values only; anything missing or unknown falls back to the default. */
export function parseSettings(raw: unknown): AppSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    aiModel: AI_MODELS.includes(r.aiModel as AiModelSetting) ? (r.aiModel as AiModelSetting) : DEFAULT_SETTINGS.aiModel,
    aiEffort: AI_EFFORTS.includes(r.aiEffort as AiEffortSetting) ? (r.aiEffort as AiEffortSetting) : DEFAULT_SETTINGS.aiEffort,
  };
}

let cache: { path: string; mtimeMs: number; settings: AppSettings } | undefined;

/** Current settings; cheap to call per request (one stat, re-read only on change). */
export function readAppSettings(): AppSettings {
  const path = settingsPath();
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return DEFAULT_SETTINGS; // never saved yet
  }
  if (cache && cache.path === path && cache.mtimeMs === mtimeMs) return cache.settings;
  let settings = DEFAULT_SETTINGS;
  try {
    settings = parseSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // A half-written or corrupt file: keep the defaults until it is fixed.
  }
  cache = { path, mtimeMs, settings };
  return settings;
}
