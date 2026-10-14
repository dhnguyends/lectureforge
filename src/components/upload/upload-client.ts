import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { CompleteUploadResponse, CreateSourceResponse } from "@/lib/contracts/source";

/**
 * Reads duration from a local media file without uploading it, so the
 * processing estimate is based on real length rather than file size.
 */
export function measureMediaDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith("video/") && !file.type.startsWith("audio/")) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const done = (ms?: number) => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      resolve(ms && Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined);
    };
    const timer = setTimeout(() => done(), 5000);
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      clearTimeout(timer);
      done(el.duration * 1000);
    };
    el.onerror = () => {
      clearTimeout(timer);
      done();
    };
    el.src = url;
  });
}

export type UploadPhase = "registering" | "uploading" | "verifying" | "queued" | "failed";

/** PUT with progress events (fetch has no upload progress). */
function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiClientError(xhr.status, "upload_failed", "The upload was rejected by storage. Please retry."));
    xhr.onerror = () => reject(new ApiClientError(0, "network", "Network error during upload. Check your connection and retry."));
    xhr.onabort = () => reject(new ApiClientError(0, "aborted", "Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(file);
  });
}

/**
 * Full upload workflow for one file:
 * register (server validates + presigns) → PUT to storage → complete
 * (server verifies size and content, then queues processing).
 */
export async function uploadSourceFile(
  studySetId: string,
  file: File,
  opts: {
    /** The user's explicit attestation from the rights checkbox. */
    rightsConfirmed: true;
    durationMs?: number;
    onPhase: (phase: UploadPhase) => void;
    onProgress: (fraction: number) => void;
    signal?: AbortSignal;
  },
): Promise<CompleteUploadResponse> {
  opts.onPhase("registering");
  const created = await apiFetch<CreateSourceResponse>(`/api/study-sets/${studySetId}/sources`, {
    method: "POST",
    json: {
      type: "upload",
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      durationMs: opts.durationMs,
      rightsConfirmed: opts.rightsConfirmed,
    },
  });
  if (!created.upload) throw new Error("Server did not return an upload URL");

  opts.onPhase("uploading");
  await putWithProgress(created.upload.url, file, created.upload.headers, opts.onProgress, opts.signal);

  opts.onPhase("verifying");
  const done = await apiFetch<CompleteUploadResponse>(`/api/sources/${created.sourceId}/complete`, { method: "POST" });
  opts.onPhase("queued");
  return done;
}

export async function addYouTubeSource(studySetId: string, url: string, rightsConfirmed: true): Promise<CreateSourceResponse> {
  return apiFetch<CreateSourceResponse>(`/api/study-sets/${studySetId}/sources`, {
    method: "POST",
    json: { type: "youtube", url, rightsConfirmed },
  });
}
