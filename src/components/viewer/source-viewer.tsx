"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpenCheck, Captions, Keyboard, Loader2, MessageSquare } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SourceIcon } from "@/components/upload/source-icons";
import { Badge } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api-client";
import { segmentAt } from "@/lib/captions";
import type { SourceKind } from "@/lib/contracts/source";
import type { AnnotationView, MediaView, SourceCitationView, TranscriptView } from "@/lib/contracts/viewer";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";
import { MediaPlayer, type PlayerHandle } from "./media-player";
import { PdfViewer, type PageRegion } from "./pdf-viewer";
import { ImageViewer, NoteViewer } from "./simple-viewers";
import { TranscriptPanel } from "./transcript-panel";

type Props = {
  studySetId: string;
  sourceId: string;
  kind: SourceKind;
  title: string;
  canEdit: boolean;
  initialMs: number | null;
  initialPage: number | null;
  anchorId: string | null;
};

const TIMED = new Set<SourceKind>(["VIDEO", "AUDIO", "YOUTUBE"]);

/**
 * The source viewer: plays or displays one source, follows along in the
 * transcript, and lists where the study guide cites it and the student's notes.
 * Deep links: ?t=<seconds> for recordings, ?page=<n> for documents, &anchor=<id>
 * to outline a specific citation.
 */
export function SourceViewer({ studySetId, sourceId, kind, title, canEdit, initialMs, initialPage, anchorId }: Props) {
  const timed = TIMED.has(kind);
  const media = useQuery({
    queryKey: ["media", sourceId],
    queryFn: () => apiFetch<MediaView>(`/api/sources/${sourceId}/media`),
    // Signed URLs last an hour; refresh before they expire.
    refetchInterval: 45 * 60 * 1000,
    staleTime: 40 * 60 * 1000,
  });
  const transcript = useQuery({
    queryKey: ["transcript", sourceId],
    queryFn: () => apiFetch<TranscriptView>(`/api/sources/${sourceId}/transcript`),
    enabled: timed,
  });
  const citations = useQuery({
    queryKey: ["source-citations", sourceId],
    queryFn: () => apiFetch<{ citations: SourceCitationView[] }>(`/api/sources/${sourceId}/citations`),
  });
  const annotations = useQuery({
    queryKey: ["annotations", sourceId],
    queryFn: () => apiFetch<{ annotations: AnnotationView[] }>(`/api/sources/${sourceId}/annotations`),
  });

  const player = useRef<PlayerHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [timeMs, setTimeMs] = useState(initialMs ?? 0);
  const segments = transcript.data?.segments ?? [];
  const current = useMemo(() => segmentAt(segments, timeMs), [segments, timeMs]);

  const focusAnchor = citations.data?.citations.find((c) => c.anchorId === anchorId) ?? null;
  const cited = focusAnchor?.startMs != null && focusAnchor.endMs != null ? { startMs: focusAnchor.startMs, endMs: focusAnchor.endMs } : initialMs !== null ? { startMs: initialMs, endMs: initialMs + 1 } : null;

  // Initial seek from a deep link, once the player exists.
  const seeked = useRef(false);
  useEffect(() => {
    if (seeked.current || !timed || !media.data) return;
    const ms = focusAnchor?.startMs ?? initialMs;
    if (ms !== null && ms !== undefined) {
      seeked.current = true;
      // Do not autoplay on load; just position the playhead.
      requestAnimationFrame(() => player.current?.seek(ms, false));
      setTimeMs(ms);
    }
  }, [timed, media.data, focusAnchor, initialMs]);

  const seek = useCallback((ms: number) => {
    player.current?.seek(ms);
    setTimeMs(ms);
  }, []);
  const onTime = useCallback((ms: number) => setTimeMs(ms), []);

  // Keyboard: space play/pause, ←/→ 5 s, "/" search — unless typing.
  useEffect(() => {
    if (!timed) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable=true], video, audio, button, a")) return;
      if (e.key === " ") {
        e.preventDefault();
        player.current?.togglePlay();
      } else if (e.key === "ArrowRight") player.current?.skip(5000);
      else if (e.key === "ArrowLeft") player.current?.skip(-5000);
      else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [timed]);

  const regions: PageRegion[] = useMemo(() => {
    const out: PageRegion[] = [];
    for (const c of citations.data?.citations ?? []) {
      const bbox = (c.region as { bbox?: [number, number, number, number] } | null)?.bbox;
      if (c.page && bbox) out.push({ page: c.page, bbox, label: c.sectionTitle, tone: "cited" });
    }
    for (const a of annotations.data?.annotations ?? []) {
      const bbox = (a.region as { bbox?: [number, number, number, number] } | null)?.bbox;
      if (a.page && bbox) out.push({ page: a.page, bbox, label: a.body ?? "Highlight", tone: "note" });
    }
    return out;
  }, [citations.data, annotations.data]);

  const focusRegion: PageRegion | null = useMemo(() => {
    const bbox = (focusAnchor?.region as { bbox?: [number, number, number, number] } | null)?.bbox;
    if (focusAnchor?.page && bbox) return { page: focusAnchor.page, bbox, tone: "cited" };
    return initialPage ? { page: initialPage, bbox: [0, 0, 1, 1] } : null;
  }, [focusAnchor, initialPage]);

  const noteLines = useMemo(() => {
    const r = focusAnchor?.region as { lineStart?: number; lineEnd?: number } | null;
    return r?.lineStart ? { start: r.lineStart, end: r.lineEnd ?? r.lineStart } : null;
  }, [focusAnchor]);

  let viewer: React.ReactNode;
  if (media.isPending) {
    viewer = (
      <p className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading source…
      </p>
    );
  } else if (media.isError || !media.data) {
    viewer = <p className="p-6 text-sm text-destructive">This source could not be loaded.</p>;
  } else if (timed) {
    viewer = (
      <div className="flex flex-col gap-3">
        <MediaPlayer ref={player} media={media.data} captionsUrl={`/api/sources/${sourceId}/captions`} onTime={onTime} onExpired={() => void media.refetch()} />
        {transcript.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading transcript…
          </p>
        ) : transcript.data ? (
          <div className="h-[min(34rem,70dvh)] min-h-[20rem]">
            <TranscriptPanel
              sourceId={sourceId}
              segments={segments}
              current={current}
              onSeek={seek}
              canEdit={canEdit}
              annotations={annotations.data?.annotations ?? []}
              cited={cited}
              searchRef={searchRef}
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No transcript yet.</p>
        )}
      </div>
    );
  } else if (!media.data.url) {
    viewer = <p className="p-6 text-sm text-muted-foreground">No viewable file for this source (slides need LibreOffice on the worker to be converted).</p>;
  } else if (kind === "PDF" || kind === "SLIDES" || kind === "DOCUMENT") {
    viewer = (
      <div className="h-[calc(100dvh-13rem)] min-h-[28rem]">
        <PdfViewer url={media.data.url} initialPage={initialPage} regions={regions} focus={focusRegion} />
      </div>
    );
  } else if (kind === "IMAGE") {
    viewer = <ImageViewer url={media.data.url} title={title} regions={regions.filter((r) => r.page === 1)} />;
  } else {
    viewer = <NoteViewer url={media.data.url} lines={noteLines} />;
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section aria-label={`Source: ${title}`} className="min-w-0 space-y-3">
        <header className="flex flex-wrap items-center gap-2">
          <SourceIcon kind={kind} className="size-5 text-muted-foreground" />
          <h2 className="mr-auto text-lg font-semibold">{title}</h2>
          {timed && transcript.data && (
            <Badge variant="outline">
              <Captions aria-hidden /> {segments.length} lines{transcript.data.diarized ? " · speakers labelled" : ""}
            </Badge>
          )}
          {timed && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground md:flex" title="Space: play/pause · ←/→: 5 s · /: search">
              <Keyboard className="size-3.5" aria-hidden /> Space · ← → · /
            </span>
          )}
        </header>
        {viewer}
      </section>

      <aside className="space-y-4" aria-label="Citations and notes">
        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <BookOpenCheck className="size-4 text-primary" aria-hidden /> Cited in your study guide
          </h3>
          {citations.isPending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : citations.data?.citations.length ? (
            <ul className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
              {citations.data.citations.map((c) => (
                <li key={c.anchorId}>
                  <button
                    type="button"
                    onClick={() => (c.startMs !== null ? seek(c.startMs) : undefined)}
                    className={cn(
                      "w-full rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted/60",
                      c.anchorId === anchorId && "border-grounded/60 bg-grounded-bg",
                      timed && current >= 0 && c.startMs !== null && c.endMs !== null && segments[current] && segments[current]!.startMs < c.endMs && segments[current]!.endMs > c.startMs && "border-primary/50",
                    )}
                  >
                    <span className="block font-mono text-xs text-timestamp">{c.startMs !== null ? formatClock(c.startMs) : c.page ? `page ${c.page}` : ""}</span>
                    <span className="line-clamp-2 font-serif text-[0.85rem]">“{c.excerpt}”</span>
                    <Link href={`/study-sets/${studySetId}/guide#section-${c.sectionId}`} className="mt-0.5 block text-xs text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                      {c.sectionTitle}
                    </Link>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No study-guide statements cite this source yet.</p>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4">
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <MessageSquare className="size-4 text-primary" aria-hidden /> Your notes &amp; highlights
          </h3>
          {annotations.data?.annotations.length ? (
            <ul className="space-y-2">
              {annotations.data.annotations.map((a) => {
                const seg = segments.find((s) => s.id === a.transcriptSegmentId);
                return (
                  <li key={a.id}>
                    <button type="button" onClick={() => seg && seek(seg.startMs)} className="w-full rounded-lg border px-2.5 py-2 text-left text-sm hover:bg-muted/60" disabled={!seg}>
                      <span className="block font-mono text-xs text-timestamp">{seg ? formatClock(seg.startMs) : a.page ? `page ${a.page}` : ""}</span>
                      <span className="line-clamp-3">{a.kind === "NOTE" ? a.body : `Highlighted: “${seg?.text ?? ""}”`}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Highlight a transcript line or add a private note — only you can see them.</p>
          )}
        </section>
      </aside>
    </div>
  );
}
