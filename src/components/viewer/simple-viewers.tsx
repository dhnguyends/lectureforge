"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { PageRegion } from "./pdf-viewer";

/** An image of notes or a whiteboard, with cited regions outlined. */
export function ImageViewer({ url, title, regions }: { url: string; title: string; regions: PageRegion[] }) {
  return (
    <div className="overflow-auto rounded-xl border bg-muted/40 p-3">
      <div className="relative mx-auto w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL, not optimisable */}
        <img src={url} alt={title} className="block max-w-full rounded" />
        {regions.map((r, i) => (
          <div
            key={i}
            className="pointer-events-none absolute rounded-sm bg-grounded/15 ring-2 ring-grounded/70"
            style={{ left: `${r.bbox[0] * 100}%`, top: `${r.bbox[1] * 100}%`, width: `${(r.bbox[2] - r.bbox[0]) * 100}%`, height: `${(r.bbox[3] - r.bbox[1]) * 100}%` }}
            title={r.label}
          />
        ))}
      </div>
    </div>
  );
}

/** Markdown / text notes shown with line numbers; cited line ranges are highlighted. */
export function NoteViewer({ url, lines }: { url: string; lines: { start: number; end: number } | null }) {
  const text = useQuery({ queryKey: ["note-text", url], queryFn: () => fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error("unavailable")))) });
  const ref = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (lines && text.data) ref.current?.querySelector(`[data-line="${lines.start}"]`)?.scrollIntoView({ block: "center" });
  }, [lines, text.data]);

  if (text.isPending) {
    return (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading notes…
      </p>
    );
  }
  if (text.isError) return <p className="p-6 text-sm text-destructive">Could not load this note.</p>;
  return (
    <ol ref={ref} className="overflow-auto rounded-xl border bg-card py-3 font-mono text-[0.85rem] leading-relaxed" aria-label="Note text">
      {text.data!.replace(/\r\n?/g, "\n").split("\n").map((line, i) => {
        const n = i + 1;
        const hit = lines !== null && n >= lines.start && n <= lines.end;
        return (
          <li key={n} data-line={n} className={cn("flex gap-3 px-3", hit && "bg-grounded-bg")}>
            <span className="w-8 shrink-0 text-right text-muted-foreground select-none">{n}</span>
            <span className="whitespace-pre-wrap">{line || " "}</span>
          </li>
        );
      })}
    </ol>
  );
}
