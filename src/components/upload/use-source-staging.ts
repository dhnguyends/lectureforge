"use client";

import { useCallback, useRef, useState } from "react";
import { ApiClientError } from "@/lib/api-client";
import { estimateProcessing, validateFile, type ProcessingEstimate, type UploadKind } from "@/lib/uploads/policy";
import { parseYouTubeUrl } from "@/lib/youtube";
import { addYouTubeSource, measureMediaDuration, uploadSourceFile, type UploadPhase } from "./upload-client";

export type ItemPhase = "staged" | UploadPhase | "done";

type Base = { id: string; phase: ItemPhase; progress: number; error?: string; estimate?: ProcessingEstimate };

export type StagedItem =
  | (Base & { type: "file"; file: File; kind: UploadKind | null; durationMs?: number })
  | (Base & { type: "youtube"; url: string; videoId: string });

const UPLOAD_CONCURRENCY = 2;

let seq = 0;
const nextId = () => `staged-${++seq}`;

/** Holds files/links the user has chosen and runs the upload workflow for them. */
export function useSourceStaging() {
  const [items, setItems] = useState<StagedItem[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, update: Partial<Base> & { durationMs?: number }) => {
    setItems((prev) => prev.map((it) => (it.id === id ? ({ ...it, ...update } as StagedItem) : it)));
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const added: StagedItem[] = files.map((file) => {
        const check = validateFile({ name: file.name, mimeType: file.type, sizeBytes: file.size });
        return {
          id: nextId(),
          type: "file",
          file,
          kind: check.ok ? check.kind : null,
          phase: "staged",
          progress: 0,
          error: check.ok ? undefined : check.reason,
          estimate: check.ok ? estimateProcessing({ kind: check.kind, sizeBytes: file.size }) : undefined,
        };
      });
      setItems((prev) => [...prev, ...added]);
      // Refine media estimates with the real duration, read locally.
      for (const item of added) {
        if (item.type !== "file" || !item.kind || (item.kind !== "VIDEO" && item.kind !== "AUDIO")) continue;
        void measureMediaDuration(item.file).then((durationMs) => {
          if (!durationMs) return;
          patch(item.id, {
            durationMs,
            estimate: estimateProcessing({ kind: item.kind!, sizeBytes: item.file.size, durationMs }),
          });
        });
      }
    },
    [patch],
  );

  const addYouTube = useCallback(
    (url: string): string | null => {
      const parsed = parseYouTubeUrl(url);
      if (!parsed) return "Paste a link to a single YouTube video.";
      if (items.some((i) => i.type === "youtube" && i.videoId === parsed.videoId)) return "That video is already added.";
      setItems((prev) => [
        ...prev,
        {
          id: nextId(),
          type: "youtube",
          url: parsed.canonicalUrl,
          videoId: parsed.videoId,
          phase: "staged",
          progress: 0,
          estimate: estimateProcessing({ kind: "YOUTUBE" }),
        },
      ]);
      return null;
    },
    [items],
  );

  const remove = useCallback((id: string) => setItems((prev) => prev.filter((i) => i.id !== id)), []);

  /**
   * Uploads every valid staged item. Returns counts so the caller can decide
   * whether to navigate on. Failed items stay in the list with their error.
   */
  const uploadAll = useCallback(
    async (studySetId: string, rightsConfirmed: true): Promise<{ succeeded: number; failed: number }> => {
      const queue = items.filter((i) => i.phase === "staged" || i.phase === "failed").filter((i) => i.type === "youtube" || i.kind);
      abort.current = new AbortController();
      setBusy(true);
      let succeeded = 0;
      let failed = 0;

      const runOne = async (item: StagedItem) => {
        patch(item.id, { error: undefined, progress: 0 });
        try {
          if (item.type === "youtube") {
            patch(item.id, { phase: "registering" });
            await addYouTubeSource(studySetId, item.url, rightsConfirmed);
          } else {
            await uploadSourceFile(studySetId, item.file, {
              rightsConfirmed,
              durationMs: item.durationMs,
              signal: abort.current?.signal,
              onPhase: (phase) => patch(item.id, { phase }),
              onProgress: (progress) => patch(item.id, { progress }),
            });
          }
          patch(item.id, { phase: "done", progress: 1 });
          succeeded++;
        } catch (err) {
          patch(item.id, { phase: "failed", error: err instanceof ApiClientError ? err.message : "Upload failed. Please retry." });
          failed++;
        }
      };

      const pending = [...queue];
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, pending.length) }, async () => {
          for (let next = pending.shift(); next; next = pending.shift()) await runOne(next);
        }),
      );
      setBusy(false);
      return { succeeded, failed };
    },
    [items, patch],
  );

  const cancel = useCallback(() => abort.current?.abort(), []);

  const valid = items.filter((i) => i.type === "youtube" || i.kind);
  const totalEstimate = valid.reduce(
    (acc, i) => ({ minSeconds: Math.max(acc.minSeconds, i.estimate?.minSeconds ?? 0), maxSeconds: Math.max(acc.maxSeconds, i.estimate?.maxSeconds ?? 0) }),
    { minSeconds: 0, maxSeconds: 0 },
  );

  return { items, busy, addFiles, addYouTube, remove, uploadAll, cancel, validCount: valid.length, totalEstimate };
}

export type SourceStaging = ReturnType<typeof useSourceStaging>;
