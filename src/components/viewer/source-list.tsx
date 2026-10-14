import Link from "next/link";
import { StatusBadge } from "@/components/jobs/status-badge";
import { SourceIcon, SOURCE_LABELS } from "@/components/upload/source-icons";
import type { SourceKind, SourceStatus } from "@/lib/contracts/source";
import { formatClock } from "@/lib/time";

export type SourceListItem = { id: string; kind: SourceKind; title: string; status: SourceStatus; durationMs: number | null; pageCount: number | null; segments?: number };

export function SourceList({ studySetId, sources, empty }: { studySetId: string; sources: SourceListItem[]; empty: React.ReactNode }) {
  if (!sources.length) return <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sources.map((s) => {
        const meta = [SOURCE_LABELS[s.kind], s.durationMs ? formatClock(s.durationMs) : null, s.pageCount ? `${s.pageCount} pages` : null, s.segments ? `${s.segments} transcript lines` : null].filter(Boolean);
        const body = (
          <>
            <div className="flex items-center gap-2">
              <SourceIcon kind={s.kind} className="size-5 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium">{s.title}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{meta.join(" · ")}</p>
            <div className="mt-2">
              <StatusBadge status={s.status} />
            </div>
          </>
        );
        return (
          <li key={s.id}>
            {s.status === "READY" ? (
              <Link href={`/study-sets/${studySetId}/sources/${s.id}`} className="block h-full rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
                {body}
              </Link>
            ) : (
              <div className="h-full rounded-xl border bg-card p-4 opacity-80">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
