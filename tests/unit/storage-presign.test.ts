import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  Object.assign(process.env, {
    DATABASE_URL: "postgresql://x:y@localhost:5432/z",
    S3_ENDPOINT: "http://localhost:9000",
    S3_BUCKET: "bucket",
    S3_ACCESS_KEY_ID: "key",
    S3_SECRET_ACCESS_KEY: "secret",
    S3_FORCE_PATH_STYLE: "true",
  });
});

describe("createUploadUrl", () => {
  it("signs Content-Type and Content-Length but no body checksum", async () => {
    const { createUploadUrl } = await import("@/lib/storage");
    const { url } = await createUploadUrl("ws/a/sets/b/sources/c/original/x.pdf", "application/pdf", 1234);
    const params = new URL(url).searchParams;
    // A checksum computed at signing time would never match the browser's upload.
    expect([...params.keys()].some((k) => k.toLowerCase().includes("checksum"))).toBe(false);
    expect(params.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(params.get("X-Amz-SignedHeaders")).toContain("content-type");
  });
});
