"use client";

import { CheckCircle2, Clock, ExternalLink, FileText } from "lucide-react";
import Link from "next/link";
import { SourceIcon } from "@/components/upload/source-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ClaimLabel } from "@/lib/citations/markers";
import type { SourceKind } from "@/lib/contracts/source";
import type { AnchorView } from "@/lib/contracts/study-guide";
import { sourceHref } from "@/lib/source-links";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { CLAIM_LABELS } from "./provenance";

const CHIP: Record<ClaimLabel, string> = {
  grounded: "bg-grounded-bg text-grounded",
  inference: "bg-inference-bg text-inference",
  external: "bg-practice-bg text-practice",
  unverified: "bg-destructive/10 text-destructive",
};

export function locationLabel(a: AnchorView): string {
  if (a.startMs !== null) return a.endMs !== null && a.endMs !== a.startMs ? `${formatClock(a.startMs)}–${formatClock(a.endMs)}` : formatClock(a.startMs);
  if (a.page !== null) return `page ${a.page}`;
  return "notes";
}

/**
 * A numbered citation after a statement. Opens a popover with the provenance
 * label and, for each verified anchor, the exact source excerpt and location.
 */
export function CitationChip({ number, label, anchors, studySetId }: { number: number; label: ClaimLabel; anchors: AnchorView[]; studySetId: string }) {
  const meta = CLAIM_LABELS[label];
  const Icon = meta.icon;
  const first = anchors[0];
  const summary = first ? `${first.sourceTitle}, ${locationLabel(first)}` : meta.text;

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center gap-0.5 rounded px-1 align-middle font-sans text-[0.7rem] font-semibold tabular-nums ring-offset-1 hover:ring-1 hover:ring-current",
          CHIP[label],
        )}
        aria-label={`Citation ${number}: ${meta.text}. ${summary}`}
      >
        {label !== "grounded" && <Icon className="size-3" aria-hidden />}
        {number}
      </PopoverTrigger>
      <PopoverContent>
        <p className={cn("mb-3 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium", CHIP[label])}>
          <Icon className="size-3.5" aria-hidden /> {meta.text}
        </p>
        {anchors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {label === "external"
              ? "This statement comes from general background knowledge, not from your materials."
              : "No passage in your materials could be verified for this statement. Check it before relying on it."}
          </p>
        ) : (
          <ul className="space-y-3">
            {anchors.map((a) => (
              <li key={a.id} className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <SourceIcon kind={a.sourceKind as SourceKind} className="size-4 text-muted-foreground" />
                  <span className="truncate">{a.sourceTitle}</span>
                  <span className="inline-flex shrink-0 items-center gap-1 font-mono text-xs text-timestamp">
                    {a.startMs !== null ? <Clock className="size-3" aria-hidden /> : <FileText className="size-3" aria-hidden />}
                    {locationLabel(a)}
                  </span>
                </p>
                <blockquote className="border-l-2 border-border pl-3 font-serif text-sm leading-relaxed text-foreground/90">“{a.excerpt}”</blockquote>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {a.verified ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CheckCircle2 className="size-3 text-success" aria-hidden /> Excerpt verified in the source text
                    </p>
                  ) : (
                    <span />
                  )}
                  <Link
                    href={sourceHref(studySetId, a.sourceId, { startMs: a.startMs, page: a.page, anchorId: a.id })}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="size-3" aria-hidden /> Open in source
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
