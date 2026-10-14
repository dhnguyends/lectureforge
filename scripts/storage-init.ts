/**
 * Creates the storage bucket and the CORS rule that lets the browser PUT to
 * presigned URLs. Works against any S3-compatible service (local SeaweedFS,
 * AWS S3, Cloudflare R2, …) and is safe to run repeatedly.
 */
import "dotenv/config";
import {
  CreateBucketCommand,
  GetBucketCorsCommand,
  HeadBucketCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "../src/lib/env";

const e = env();
const s3 = new S3Client({
  region: e.S3_REGION,
  endpoint: e.S3_ENDPOINT,
  forcePathStyle: e.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
});
const Bucket = e.S3_BUCKET;

async function waitForService(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket }));
      return;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      // 404 / 403 mean the service is up and answering.
      if (status === 404 || status === 403 || status === 301) return;
      if (Date.now() > deadline) throw new Error(`Storage at ${e.S3_ENDPOINT} did not become ready: ${String(err)}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function main() {
  await waitForService();

  try {
    await s3.send(new CreateBucketCommand({ Bucket }));
    console.log(`Created bucket "${Bucket}".`);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw err;
    console.log(`Bucket "${Bucket}" already exists.`);
  }

  const origins = [...new Set([e.APP_URL, "http://localhost:3000"])];
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: origins,
              AllowedMethods: ["PUT", "GET", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    const cors = await s3.send(new GetBucketCorsCommand({ Bucket }));
    console.log(`CORS allows: ${cors.CORSRules?.flatMap((r) => r.AllowedOrigins ?? []).join(", ")}`);
  } catch (err) {
    console.warn(`Could not set bucket CORS (${(err as Error).name}). Configure it in your storage provider so ${origins.join(", ")} can PUT.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
