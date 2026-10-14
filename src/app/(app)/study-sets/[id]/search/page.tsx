import { Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { SourceIcon } from "@/components/upload/source-icons";
import { Badge } from "@/components/ui/primitives";
import type { SourceKind } from "@/lib/contracts/source";
import { formatClock } from "@/lib/time";
import { searchStudySet } from "@/server/services/viewer";
import { loadStudySet } from "../load";

export const metadata: Metadata = { title: "Search" };

const MATCH_LABEL = { keyword: "Keyword match", semantic: "Similar meaning", both: "Keyword + meaning" } as const;

export default async function SearchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string }> }) {
  const set = await loadStudySet((await params).id);
  const q = ((await searchParams).q ?? "").slice(0, 300);
  const results = q ? await searchStudySet(set.id, q) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <form role="search" action={`/study-sets/${set.id}/search`} className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          name="q"
          defaultValue={q}
          autoFocus
          placeholder="Search every recording, slide deck, paper and note…"
          aria-label="Search sources"
          className="h-11 w-full rounded-lg border border-input bg-card pr-3 pl-9 text-sm shadow-xs"
        />
      </form>
      {q && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {results.length ? `${results.length} passage${results.length === 1 ? "" : "s"} for “${q}”` : `Nothing in your sources matches “${q}”.`}
        </p>
      )}
      <ol className="space-y-3">
        {results.map((r) => (
          <li key={r.chunkId}>
            <Link href={r.href} className="block rounded-xl border bg-card p-4 transition-colors hover:border-primary/40">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
                <SourceIcon kind={r.sourceKind as SourceKind} className="size-4 text-muted-foreground" />
                <span className="font-medium">{r.sourceTitle}</span>
                <span className="font-mono text-xs text-timestamp">{r.startMs !== null ? formatClock(r.startMs) : r.page ? `page ${r.page}` : ""}</span>
                <Badge variant="muted" className="ml-auto">
                  {MATCH_LABEL[r.match]}
                </Badge>
              </div>
              {r.headingPath.length > 0 && <p className="mb-1 text-xs text-muted-foreground">{r.headingPath.join(" › ")}</p>}
              <p className="font-serif text-[0.95rem] leading-relaxed">
                <Snippet text={r.snippet.text} highlights={r.snippet.highlights} />
              </p>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Snippet({ text, highlights }: { text: string; highlights: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  highlights.forEach(([s, e], i) => {
    if (s > at) parts.push(text.slice(at, s));
    parts.push(
      <mark key={i} className="rounded bg-yellow-300/60 px-0.5 text-inherit dark:bg-yellow-500/35">
        {text.slice(s, e)}
      </mark>,
    );
    at = e;
  });
  parts.push(text.slice(at));
  return <>{parts}</>;
}
