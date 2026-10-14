import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

let internalClient: S3Client | undefined;
let publicClient: S3Client | undefined;

function makeClient(endpoint: string | undefined): S3Client {
  const e = env();
  return new S3Client({
    region: e.S3_REGION,
    endpoint,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    // The SDK otherwise signs an x-amz-checksum-crc32 of the (empty) body into
    // presigned PUT URLs, so S3 rejects the browser's real upload as BadDigest.
    // Checksums are also unsupported by several S3-compatible services.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

function s3(): S3Client {
  return (internalClient ??= makeClient(env().S3_ENDPOINT));
}

/** Client used only for signing URLs the browser will call. */
function s3Public(): S3Client {
  const e = env();
  return (publicClient ??= makeClient(e.S3_PUBLIC_ENDPOINT ?? e.S3_ENDPOINT));
}

const bucket = () => env().S3_BUCKET;

/** Storage layout: everything for a study set lives under one prefix. */
export const keys = {
  studySetPrefix: (workspaceId: string, studySetId: string) => `ws/${workspaceId}/sets/${studySetId}/`,
  sourcePrefix: (workspaceId: string, studySetId: string, sourceId: string) =>
    `ws/${workspaceId}/sets/${studySetId}/sources/${sourceId}/`,
  original: (prefix: string, filename: string) => `${prefix}original/${safeFilename(filename)}`,
  derived: (prefix: string, name: string) => `${prefix}derived/${name}`,
};

export function safeFilename(name: string): string {
  const cleaned = name.normalize("NFKD").replace(/[^\w.\-]+/g, "_").replace(/_+/g, "_");
  return cleaned.slice(-120) || "file";
}

const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * Presigned single PUT. Content-Type and Content-Length are part of the
 * signature, so the browser cannot upload a different type or size than the
 * server validated.
 */
export async function createUploadUrl(key: string, contentType: string, contentLength: number) {
  const command = new PutObjectCommand({
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  const url = await getSignedUrl(s3Public(), command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { url, method: "PUT" as const, headers: { "Content-Type": contentType }, expiresIn: UPLOAD_URL_TTL_SECONDS };
}

export async function createDownloadUrl(key: string, expiresIn = 15 * 60): Promise<string> {
  return getSignedUrl(s3Public(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn });
}

export async function headObject(key: string): Promise<{ sizeBytes: number; contentType?: string } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
  } catch (err) {
    if ((err as { name?: string }).name === "NotFound") return null;
    throw err;
  }
}

/** Reads the first `length` bytes of an object (for magic-byte checks). */
export async function readObjectHead(key: string, length = 4096): Promise<Uint8Array> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: `bytes=0-${length - 1}` }));
  return res.Body ? await res.Body.transformToByteArray() : new Uint8Array();
}

export async function downloadToFile(key: string, path: string): Promise<void> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error(`Empty body for ${key}`);
  await pipeline(res.Body as Readable, createWriteStream(path));
}

export async function uploadFile(key: string, path: string, contentType: string): Promise<number> {
  const { size } = await stat(path);
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: createReadStream(path),
      ContentType: contentType,
      ContentLength: size,
    }),
  );
  return size;
}

export async function uploadBuffer(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType, ContentLength: body.byteLength }));
}

/** Permanently deletes every object under a prefix. Returns the count removed. */
export async function deletePrefix(prefix: string): Promise<number> {
  if (!prefix.startsWith("ws/") || !prefix.endsWith("/")) {
    throw new Error(`Refusing to delete suspicious prefix "${prefix}"`);
  }
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await s3().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
    if (objects.length) {
      await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: objects, Quiet: true } }));
      removed += objects.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}
