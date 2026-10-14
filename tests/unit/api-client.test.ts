import { describe, expect, it } from "vitest";
import { apiFetch, ApiClientError } from "@/lib/api-client";

describe("apiFetch", () => {
  it("reports an unreachable server as a network error with a clear message", async () => {
    // Port 9 (discard) is closed on normal machines, so the connection is refused.
    const err = (await apiFetch("http://127.0.0.1:9/api/study-sets", { method: "POST", json: {} }).catch((e: unknown) => e)) as ApiClientError;
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 0, code: "network" });
    expect(err.message).toMatch(/Can't reach the LectureForge server/);
  });
});
