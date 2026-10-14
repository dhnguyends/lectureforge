"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { SourceIcon, SOURCE_LABELS } from "@/components/upload/source-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { SourceStatusView, StudySetStatusResponse } from "@/lib/contracts/source";
import { formatClock } from "@/lib/time";
import { formatBytes } from "@/lib/utils";
import { SourceProgressBar } from "./source-progress";
import { StatusBadge } from "./status-badge";

export function useStudySetStatus(studySetId: string, initial?: StudySetStatusResponse) {
  return useQuery({
    queryKey: ["study-set-status", studySetId],
    queryFn: () => apiFetch<StudySetStatusResponse>(`/api/study-sets/${studySetId}/status`),
    initialData: initial,
    // Poll quickly while anything is in flight, slowly otherwise.
    refetchInterval: (q) => (q.state.data?.active ? 2000 : 30_000),
  });
}

export function ProcessingDashboard({ studySetId, initial, canEdit }: { studySetId: string; initial: StudySetStatusResponse; canEdit: boolean }) {
  const { data } = useStudySetStatus(studySetId, initial);
  const sources = data?.sources ?? [];

  if (sources.length === 0) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">No sources yet. Add a lecture recording, slides, or notes to get started.</p>;
  }

  return (
    <ul className="space-y-3" aria-label="Source processing status">
      {sources.map((s) => (
        <SourceCard key={s.id} source={s} studySetId={studySetId} canEdit={canEdit} />
      ))}
    </ul>
  );
}

function SourceCard({ source, studySetId, canEdit }: { source: SourceStatusView; studySetId: string; canEdit: boolean }) {
  const job = source.job;
  const done = source.status === "READY";
  const failed = source.status === "FAILED";
  // Prefer progress updates over warnings for the live status line.
  const latest = job?.events.find((e) => e.level === "INFO") ?? job?.events[0];
  const meta = [
    SOURCE_LABELS[source.kind],
    source.sizeBytes ? formatBytes(source.sizeBytes) : null,
    source.durationMs ? formatClock(source.durationMs) : null,
    source.pageCount ? `${source.pageCount} pages` : null,
  ].filter(Boolean);

  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <SourceIcon kind={source.kind} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-medium" title={source.title}>
              {source.title}
            </h3>
            <StatusBadge status={source.status} />
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{meta.join(" · ")}</p>
        </div>
        {canEdit && <DeleteSourceButton sourceId={source.id} title={source.title} studySetId={studySetId} />}
      </div>

      <div className="mt-4">
        <SourceProgressBar
          title={source.title}
          kind={source.kind}
          status={source.status}
          // A job waiting in the queue has not started its first stage yet.
          stage={job && job.status !== "QUEUED" ? job.stage : null}
          progress={job?.progress ?? 0}
          message={!done && !failed ? (latest?.message ?? null) : null}
        />
      </div>

      {failed && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{source.errorMessage ?? "Processing failed."}</span>
          {canEdit && <RetryButton sourceId={source.id} studySetId={studySetId} />}
        </div>
      )}

      {done && job?.events.some((e) => e.level === "WARN") && (
        <ul className="mt-3 space-y-1 text-xs text-warning">
          {job.events
            .filter((e) => e.level === "WARN")
            .map((e) => (
              <li key={e.id}>⚠ {e.message}</li>
            ))}
        </ul>
      )}
    </li>
  );
}

function RetryButton({ sourceId, studySetId }: { sourceId: string; studySetId: string }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/sources/${sourceId}/retry`, { method: "POST" });
      await qc.invalidateQueries({ queryKey: ["study-set-status", studySetId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not retry.");
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs">{error}</span>}
      <Button size="sm" variant="outline" className="h-7 bg-card text-foreground" onClick={retry} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />} Retry
      </Button>
    </span>
  );
}

function DeleteSourceButton({ sourceId, title, studySetId }: { sourceId: string; title: string; studySetId: string }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/sources/${sourceId}`, { method: "DELETE" });
      await qc.invalidateQueries({ queryKey: ["study-set-status", studySetId] });
    } catch {
      setError("Could not delete this source. Please try again.");
      setPending(false);
    }
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`Delete ${title}`}>
          <Trash2 />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this source permanently?</DialogTitle>
          <DialogDescription>
            “{title}” will be removed along with its transcript, extracted text and stored files. Citations to it in generated materials will
            stop resolving. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Keep</Button>
          </DialogClose>
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Delete permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
