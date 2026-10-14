"use client";

import { AlertCircle, CheckCircle2, Link2, Loader2, UploadCloud, X } from "lucide-react";
import { useId, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { SourceProgressBar } from "@/components/jobs/source-progress";
import { Input, Label } from "@/components/ui/primitives";
import { ACCEPT_ATTRIBUTE } from "@/lib/uploads/policy";
import { formatClock, formatDuration, formatDurationRange } from "@/lib/time";
import { cn, formatBytes } from "@/lib/utils";
import { SourceIcon } from "./source-icons";
import type { ItemPhase, SourceStaging, StagedItem } from "./use-source-staging";

const PHASE_TEXT: Record<ItemPhase, string> = {
  staged: "Ready to upload",
  registering: "Checking…",
  uploading: "Uploading",
  verifying: "Verifying upload…",
  queued: "Queued for processing",
  done: "Uploaded — processing will start shortly",
  failed: "Failed",
};

export function SourcePicker({ staging, youtubeEnabled }: { staging: SourceStaging; youtubeEnabled: boolean }) {
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkId = useId();

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (files) => staging.addFiles(files),
    // Validation happens in addFiles so rejected files are listed with a reason.
    accept: undefined,
    noClick: true,
    noKeyboard: true,
    disabled: staging.busy,
  });

  const submitLink = () => {
    const err = staging.addYouTube(link);
    setLinkError(err);
    if (!err) setLink("");
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          isDragActive ? "border-primary bg-accent" : "border-input bg-muted/40",
        )}
      >
        <input {...getInputProps({ accept: Object.values(ACCEPT_ATTRIBUTE).flat().join(",") })} aria-label="Choose files to upload" />
        <UploadCloud className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">{isDragActive ? "Drop to add" : "Drag lecture recordings, slides, papers or notes here"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Video (MP4, MOV, WebM, MKV) · Audio · PDF · Word (.docx, .doc, .odt, .rtf) · Slides (.pptx, .ppt, .odp) · Images of notes · Markdown / text
          </p>
        </div>
        <Button type="button" variant="outline" onClick={open} disabled={staging.busy}>
          Browse files
        </Button>
      </div>

      {youtubeEnabled && (
        <div className="space-y-1.5">
          <Label htmlFor={linkId}>Or add a YouTube lecture</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id={linkId}
                type="url"
                inputMode="url"
                placeholder="https://www.youtube.com/watch?v=…"
                className="pl-8"
                value={link}
                aria-invalid={Boolean(linkError)}
                aria-describedby={linkError ? `${linkId}-error` : undefined}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitLink();
                  }
                }}
                disabled={staging.busy}
              />
            </div>
            <Button type="button" variant="secondary" onClick={submitLink} disabled={!link || staging.busy}>
              Add link
            </Button>
          </div>
          {linkError && (
            <p id={`${linkId}-error`} className="text-sm text-destructive">
              {linkError}
            </p>
          )}
        </div>
      )}

      {staging.items.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card" aria-label="Selected sources">
          {staging.items.map((item) => (
            <StagedRow key={item.id} item={item} onRemove={() => staging.remove(item.id)} disabled={staging.busy} />
          ))}
        </ul>
      )}

      {staging.validCount > 0 && staging.totalEstimate.maxSeconds > 0 && (
        <p className="text-sm text-muted-foreground">
          Estimated processing after upload: {formatDurationRange(staging.totalEstimate.minSeconds, staging.totalEstimate.maxSeconds)}. Sources are processed in parallel; you can leave the page once uploads finish.
        </p>
      )}
    </div>
  );
}

function StagedRow({ item, onRemove, disabled }: { item: StagedItem; onRemove: () => void; disabled: boolean }) {
  const invalid = item.type === "file" && !item.kind;
  const name = item.type === "file" ? item.file.name : item.url;
  const meta =
    item.type === "file"
      ? [formatBytes(item.file.size), item.durationMs ? formatClock(item.durationMs) : null].filter(Boolean).join(" · ")
      : "YouTube video";
  const failed = item.phase === "failed" || invalid;
  const active = ["registering", "uploading", "verifying"].includes(item.phase);

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <SourceIcon kind={item.type === "youtube" ? "YOUTUBE" : (item.kind ?? "NOTE")} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-medium" title={name}>
            {name}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{meta}</span>
        </div>
        {["registering", "uploading", "verifying"].includes(item.phase) && (
          <SourceProgressBar
            title={name}
            kind={item.type === "youtube" ? "YOUTUBE" : (item.kind ?? "NOTE")}
            status="PENDING_UPLOAD"
            stage={null}
            progress={0}
            uploadFraction={item.phase === "verifying" ? 1 : item.progress}
            message={item.phase === "verifying" ? "Verifying the upload…" : null}
          />
        )}
        {/* While uploading, the progress bar above carries the status. */}
        {!active && (
        <p className={cn("flex items-center gap-1.5 text-xs", failed ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {failed ? (
            <AlertCircle className="size-3.5" aria-hidden />
          ) : active ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : item.phase === "done" || item.phase === "queued" ? (
            <CheckCircle2 className="size-3.5 text-success" aria-hidden />
          ) : null}
          <span>
            {invalid ? item.error : item.phase === "failed" ? `Failed: ${item.error}` : PHASE_TEXT[item.phase]}
            {item.phase === "uploading" && ` ${Math.round(item.progress * 100)}%`}
            {item.phase === "staged" && item.estimate && ` · processing ≈ ${formatDuration(item.estimate.maxSeconds)} max`}
          </span>
        </p>
        )}
      </div>
      {(item.phase === "staged" || failed) && (
        <Button type="button" variant="ghost" size="icon" className="size-7" onClick={onRemove} disabled={disabled} aria-label={`Remove ${name}`}>
          <X />
        </Button>
      )}
    </li>
  );
}
