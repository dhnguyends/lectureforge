"use client";

import { AlertTriangle, CalendarClock, LayoutGrid, List, Layers, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/primitives";
import type { StudySetSummary } from "@/lib/contracts/study-set";
import { cn, pluralize } from "@/lib/utils";

type View = "grid" | "list";

function daysUntil(date: string): number {
  return Math.ceil((new Date(`${date}T00:00:00`).getTime() - Date.now()) / 86_400_000);
}

export function StudySetCollection({ sets }: { sets: StudySetSummary[] }) {
  const [view, setView] = useState<View>("grid");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("lf-dashboard-view");
      if (saved === "list" || saved === "grid") setView(saved);
    } catch {
      // ignore unavailable storage
    }
  }, []);

  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("lf-dashboard-view", v);
    } catch {
      // ignore unavailable storage
    }
  };

  return (
    <section aria-labelledby="sets-heading">
      <div className="mb-3 flex items-center justify-between">
        <h2 id="sets-heading" className="text-lg font-semibold">
          Study sets
        </h2>
        <div role="group" aria-label="Layout" className="flex rounded-md border p-0.5">
          {(["grid", "list"] as const).map((v) => (
            <Button
              key={v}
              variant="ghost"
              size="sm"
              className={cn("h-7 px-2", view === v && "bg-accent")}
              aria-pressed={view === v}
              onClick={() => choose(v)}
            >
              {v === "grid" ? <LayoutGrid aria-hidden /> : <List aria-hidden />}
              <span className="sr-only">{v === "grid" ? "Grid view" : "List view"}</span>
            </Button>
          ))}
        </div>
      </div>
      <ul className={cn(view === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "divide-y rounded-xl border bg-card")}>
        {sets.map((s) => (
          <li key={s.id}>{view === "grid" ? <SetCard set={s} /> : <SetRow set={s} />}</li>
        ))}
      </ul>
    </section>
  );
}

function SetMeta({ set }: { set: StudySetSummary }) {
  const { total, ready, processing, failed } = set.sourceCounts;
  const days = set.examDate ? daysUntil(set.examDate) : null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="muted">{pluralize(total, "source")}</Badge>
      {processing > 0 && (
        <Badge variant="default">
          <Loader2 className="animate-spin" aria-hidden /> {processing} processing
        </Badge>
      )}
      {failed > 0 && (
        <Badge variant="destructive">
          <AlertTriangle aria-hidden /> {failed} failed
        </Badge>
      )}
      {ready > 0 && processing === 0 && failed === 0 && <Badge variant="grounded">All ready</Badge>}
      {set.dueCards > 0 && (
        <Badge variant="outline">
          <Layers aria-hidden /> {set.dueCards} due
        </Badge>
      )}
      {days !== null && days >= 0 && (
        <Badge variant={days <= 7 ? "inference" : "outline"}>
          <CalendarClock aria-hidden /> Exam in {pluralize(days, "day")}
        </Badge>
      )}
    </div>
  );
}

function SetCard({ set }: { set: StudySetSummary }) {
  return (
    <Card className="group relative h-full p-4 transition-colors hover:border-primary/40">
      <p className="truncate text-xs text-muted-foreground">{[set.course, set.subject].filter(Boolean).join(" · ") || " "}</p>
      <h3 className="mt-1 line-clamp-2 font-medium">
        <Link href={`/study-sets/${set.id}`} className="after:absolute after:inset-0 focus-visible:outline-none">
          {set.title}
        </Link>
      </h3>
      <div className="mt-3">
        <SetMeta set={set} />
      </div>
    </Card>
  );
}

function SetRow({ set }: { set: StudySetSummary }) {
  return (
    <div className="relative flex flex-col gap-2 px-4 py-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Link href={`/study-sets/${set.id}`} className="font-medium after:absolute after:inset-0">
          {set.title}
        </Link>
        <p className="truncate text-xs text-muted-foreground">{[set.course, set.subject].filter(Boolean).join(" · ")}</p>
      </div>
      <SetMeta set={set} />
    </div>
  );
}
