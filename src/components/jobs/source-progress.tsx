import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import type { ProcessingStage, SourceKind, SourceStatus } from "@/lib/contracts/source";
import { STAGE_LABELS, STAGE_PLANS } from "@/lib/pipeline-plan";
import { cn } from "@/lib/utils";

type SegmentState = "done" | "active" | "failed" | "pending";

export type SourceProgressInput = {
  kind: SourceKind;
  status: SourceStatus;
  /** Current pipeline stage of the ingest job, if any. */
  stage: ProcessingStage | null;
  /** Ingest job progress across its stages, 0..1. */
  progress: number;
  /** Browser upload progress 0..1 while the file is still being sent. */
  uploadFraction?: number;
  /** Latest worker message, e.g. "Transcribed part 2 of 4 · about 3 min left". */
  message?: string | null;
};

const LABEL: Partial<Record<ProcessingStage, string>> = { UPLOADING: "Upload" };

/**
 * Stages shown for a document: the upload, then the worker's plan for its kind
 * (YouTube's plan already starts with fetching, which takes the upload's place).
 */
export function displayStages(kind: SourceKind): ProcessingStage[] {
  const plan = STAGE_PLANS[kind];
  return plan[0] === "UPLOADING" ? plan : ["UPLOADING", ...plan];
}

/** Pure: segment states, the fill of the active segment, and overall progress. */
export function computeSourceProgress(input: SourceProgressInput) {
  const stages = displayStages(input.kind);
  const plan = STAGE_PLANS[input.kind];
  const offset = stages.length - plan.length; // 1 when an upload segment was prepended
  const n = stages.length;
  const states: SegmentState[] = new Array(n).fill("pending");
  let activeIndex = -1;
  let fill = 0;

  if (input.status === "READY") {
    states.fill("done");
    return { stages, states, activeIndex, fill: 1, overall: 1 };
  }
  if (input.status === "PENDING_UPLOAD") {
    activeIndex = 0;
    fill = Math.min(1, Math.max(0, input.uploadFraction ?? 0));
  } else {
    // Uploaded: the upload segment is complete; locate the worker's stage.
    const planIndex = input.stage ? plan.indexOf(input.stage) : -1;
    if (planIndex >= 0) {
      activeIndex = planIndex + offset;
      // Job progress is spread evenly over the plan's stages.
      fill = Math.min(1, Math.max(0, input.progress * plan.length - planIndex));
    } else if (offset === 1) {
      activeIndex = 1; // queued: waiting for the first processing stage
      fill = 0;
    } else {
      activeIndex = 0;
    }
  }
  for (let i = 0; i < activeIndex; i++) states[i] = "done";
  if (activeIndex >= 0) states[activeIndex] = input.status === "FAILED" ? "failed" : "active";
  const overall = (Math.max(0, activeIndex) + (input.status === "FAILED" ? 0 : fill)) / n;
  return { stages, states, activeIndex, fill, overall };
}

/**
 * One bar per document: a segment per processing stage, the current stage
 * filling live, the stage name, overall percentage and the latest worker
 * message underneath. Status is conveyed by text and icons, not colour alone.
 */
export function SourceProgressBar(props: SourceProgressInput & { title: string }) {
  const { stages, states, activeIndex, fill, overall } = computeSourceProgress(props);
  const pct = Math.round(overall * 100);
  const active = activeIndex >= 0 ? stages[activeIndex]! : null;
  const ready = props.status === "READY";
  const failed = props.status === "FAILED";
  const activeLabel = active ? (LABEL[active] ?? STAGE_LABELS[active]) : "";
  const statusText = ready
    ? "Ready to study"
    : failed
      ? `Failed during ${activeLabel.toLowerCase()}`
      : props.status === "PENDING_UPLOAD"
        ? `Uploading · ${Math.round(fill * 100)}%`
        : props.status === "UPLOADED" && !props.stage
          ? "Queued for processing"
          : `${activeLabel} · ${pct}%`;

  return (
    <div className="space-y-1.5">
      <div
        role="progressbar"
        aria-label={`Processing ${props.title}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={ready ? "Ready" : `${statusText} (stage ${activeIndex + 1} of ${stages.length})`}
        className="flex gap-1"
      >
        {stages.map((stage, i) => {
          const state = states[i]!;
          const width = state === "done" ? 100 : state === "active" ? Math.max(4, fill * 100) : state === "failed" ? 100 : 0;
          return (
            <div key={stage} className="min-w-0 flex-1" title={`${LABEL[stage] ?? STAGE_LABELS[stage]}: ${state}`}>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-700",
                    state === "done" && (ready ? "bg-success" : "bg-primary"),
                    state === "active" && "bg-primary",
                    state === "failed" && "bg-destructive",
                    state === "active" && fill === 0 && "animate-pulse bg-primary/40",
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
              <p
                className={cn(
                  "mt-1 truncate text-[0.65rem] leading-tight",
                  state === "pending" ? "text-muted-foreground/70" : state === "failed" ? "font-medium text-destructive" : "text-foreground",
                  state === "active" && "font-semibold",
                  // Narrow screens: only the current stage keeps its label.
                  state !== "active" && state !== "failed" && "max-sm:invisible",
                )}
              >
                {LABEL[stage] ?? STAGE_LABELS[stage]}
              </p>
            </div>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-live="polite">
        {ready ? (
          <CheckCircle2 className="size-3.5 text-success" aria-hidden />
        ) : failed ? (
          <AlertTriangle className="size-3.5 text-destructive" aria-hidden />
        ) : (
          <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden />
        )}
        <span className={cn("font-medium", ready ? "text-success" : failed ? "text-destructive" : "text-foreground")}>{statusText}</span>
        {!ready && props.message && <span className="truncate">· {props.message}</span>}
      </p>
    </div>
  );
}
