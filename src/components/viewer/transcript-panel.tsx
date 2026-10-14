"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Flag, Highlighter, Loader2, LocateFixed, MessageSquarePlus, Pencil, RotateCcw, Search, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { AnnotationView, SegmentView } from "@/lib/contracts/viewer";
import { formatClock } from "@/lib/time";
import { cn } from "@/lib/utils";

type Props = {
  sourceId: string;
  segments: SegmentView[];
  current: number;
  onSeek: (ms: number) => void;
  canEdit: boolean;
  annotations: AnnotationView[];
  /** Segment range to emphasise, e.g. the span of an opened citation. */
  cited: { startMs: number; endMs: number } | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

/**
 * Follow-along transcript: highlights the line being spoken, scrolls with
 * playback (until the student scrolls away), searchable, and editable —
 * corrections, "inaccurate" flags, private highlights and notes.
 */
export function TranscriptPanel({ sourceId, segments, current, onSeek, canEdit, annotations, cited, searchRef }: Props) {
  const listRef = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState(0);
  const programmaticScroll = useRef(false);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return segments.flatMap((s, i) => (s.text.toLowerCase().includes(q) ? [i] : []));
  }, [query, segments]);

  const byLine = useMemo(() => {
    const m = new Map<string, AnnotationView[]>();
    for (const a of annotations) if (a.transcriptSegmentId) m.set(a.transcriptSegmentId, [...(m.get(a.transcriptSegmentId) ?? []), a]);
    return m;
  }, [annotations]);

  // Scrolls only the transcript list (never the page) to centre a line.
  const scrollTo = useCallback((index: number) => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!list || !el) return;
    programmaticScroll.current = true;
    list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2, behavior: "smooth" });
    setTimeout(() => (programmaticScroll.current = false), 600);
  }, []);

  useEffect(() => {
    if (follow && current >= 0) scrollTo(current);
  }, [current, follow, scrollTo]);

  useEffect(() => {
    if (matches.length) scrollTo(matches[Math.min(hit, matches.length - 1)]!);
  }, [matches, hit, scrollTo]);

  const stepHit = (d: number) => matches.length && setHit((h) => (h + d + matches.length) % matches.length);

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHit(0);
              setFollow(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepHit(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") setQuery("");
            }}
            placeholder="Search transcript ( / )"
            aria-label="Search transcript"
            className="h-8 pl-8"
          />
        </div>
        {query.trim().length >= 2 && (
          <span className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {matches.length ? `${Math.min(hit, matches.length - 1) + 1}/${matches.length}` : "0"}
            <Button variant="ghost" size="icon" className="size-7" onClick={() => stepHit(-1)} aria-label="Previous match">
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon" className="size-7" onClick={() => stepHit(1)} aria-label="Next match">
              <ChevronDown />
            </Button>
          </span>
        )}
        {!follow && (
          <Button variant="outline" size="sm" className="h-8" onClick={() => setFollow(true)}>
            <LocateFixed aria-hidden /> Follow
          </Button>
        )}
      </div>
      <ol
        ref={listRef}
        className="relative min-h-0 flex-1 overflow-y-auto p-2"
        aria-label="Transcript"
        onWheel={() => !programmaticScroll.current && setFollow(false)}
        onTouchMove={() => setFollow(false)}
      >
        {segments.map((s, i) => (
          <TranscriptLine
            key={s.id}
            index={i}
            segment={s}
            active={i === current}
            match={matches.includes(i)}
            inCited={cited !== null && s.startMs < cited.endMs && s.endMs > cited.startMs}
            speakerChanged={i === 0 || segments[i - 1]!.speaker !== s.speaker}
            annotations={byLine.get(s.id) ?? []}
            onSeek={onSeek}
            canEdit={canEdit}
            sourceId={sourceId}
            query={query.trim()}
          />
        ))}
      </ol>
    </div>
  );
}

const COLORS: Record<string, string> = { yellow: "bg-yellow-200/60 dark:bg-yellow-500/25", green: "bg-green-200/60 dark:bg-green-500/25", blue: "bg-sky-200/60 dark:bg-sky-500/25", pink: "bg-pink-200/60 dark:bg-pink-500/25" };

const TranscriptLine = memo(function TranscriptLine({
  index,
  segment: s,
  active,
  match,
  inCited,
  speakerChanged,
  annotations,
  onSeek,
  canEdit,
  sourceId,
  query,
}: {
  index: number;
  segment: SegmentView;
  active: boolean;
  match: boolean;
  inCited: boolean;
  speakerChanged: boolean;
  annotations: AnnotationView[];
  onSeek: (ms: number) => void;
  canEdit: boolean;
  sourceId: string;
  query: string;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<null | "edit" | "flag" | "note">(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const highlight = annotations.find((a) => a.kind === "HIGHLIGHT");
  const notes = annotations.filter((a) => a.kind === "NOTE");

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ["transcript", sourceId] }), qc.invalidateQueries({ queryKey: ["annotations", sourceId] })]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      setMode(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  };

  const patch = (body: object) => run(() => apiFetch(`/api/transcript-segments/${s.id}`, { method: "PATCH", json: body }));
  const toggleHighlight = () =>
    run(() =>
      highlight
        ? apiFetch(`/api/annotations/${highlight.id}`, { method: "DELETE" })
        : apiFetch(`/api/sources/${sourceId}/annotations`, { method: "POST", json: { kind: "HIGHLIGHT", transcriptSegmentId: s.id } }),
    );

  return (
    <li
      data-index={index}
      aria-current={active ? "true" : undefined}
      className={cn(
        "group relative rounded-md px-2 py-1.5 [contain-intrinsic-size:auto_3rem] [content-visibility:auto]",
        active && "bg-accent",
        inCited && !active && "bg-grounded-bg/70",
        match && "ring-1 ring-primary/50",
      )}
    >
      {speakerChanged && s.speaker && <p className="mb-0.5 text-[0.7rem] font-semibold text-muted-foreground uppercase">{s.speaker}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSeek(s.startMs)}
          className="mt-0.5 shrink-0 font-mono text-xs text-timestamp tabular-nums hover:underline"
          aria-label={`Play from ${formatClock(s.startMs)}`}
        >
          {formatClock(s.startMs)}
        </button>
        <div className="min-w-0 flex-1">
          {mode === "edit" ? (
            <LineEditor
              value={draft}
              onChange={setDraft}
              busy={busy}
              onCancel={() => setMode(null)}
              onSave={() => patch({ text: draft })}
              label="Correct this line"
            />
          ) : (
            <p
              className={cn(
                "cursor-pointer font-serif text-[0.95rem] leading-relaxed",
                highlight && COLORS[highlight.color ?? "yellow"],
                s.flaggedInaccurate && "text-muted-foreground line-through decoration-destructive/60",
              )}
              onClick={() => onSeek(s.startMs)}
            >
              <Highlighted text={s.text} query={query} />
            </p>
          )}
          {(s.edited || s.flaggedInaccurate) && mode !== "edit" && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.7rem] text-muted-foreground">
              {s.edited && (
                <span title={`Original: ${s.originalText}`}>
                  <Pencil className="mr-0.5 inline size-3" aria-hidden />
                  Corrected
                </span>
              )}
              {s.flaggedInaccurate && (
                <span className="text-destructive">
                  <Flag className="mr-0.5 inline size-3" aria-hidden />
                  Marked inaccurate — excluded from generation{s.flagNote ? `: ${s.flagNote}` : ""}
                </span>
              )}
            </p>
          )}
          {notes.map((n) => (
            <p key={n.id} className="mt-1 flex items-start gap-1 rounded bg-muted/70 px-2 py-1 text-xs">
              <MessageSquarePlus className="mt-0.5 size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex-1">{n.body}</span>
              <button type="button" onClick={() => run(() => apiFetch(`/api/annotations/${n.id}`, { method: "DELETE" }))} aria-label="Delete note">
                <X className="size-3" />
              </button>
            </p>
          ))}
          {mode === "flag" && (
            <LineEditor value={draft} onChange={setDraft} busy={busy} onCancel={() => setMode(null)} onSave={() => patch({ flaggedInaccurate: true, flagNote: draft || null })} label="What is wrong? (optional)" small />
          )}
          {mode === "note" && (
            <LineEditor
              value={draft}
              onChange={setDraft}
              busy={busy}
              onCancel={() => setMode(null)}
              onSave={() => run(() => apiFetch(`/api/sources/${sourceId}/annotations`, { method: "POST", json: { kind: "NOTE", transcriptSegmentId: s.id, body: draft } }))}
              label="Private note"
              small
            />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        {mode === null && (
          <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-md:opacity-100">
            {busy && <Loader2 className="mt-1 size-3.5 animate-spin text-muted-foreground" aria-hidden />}
            <IconButton label={highlight ? "Remove highlight" : "Highlight"} onClick={toggleHighlight} pressed={Boolean(highlight)}>
              <Highlighter />
            </IconButton>
            <IconButton label="Add note" onClick={() => (setDraft(""), setMode("note"))}>
              <MessageSquarePlus />
            </IconButton>
            {canEdit && (
              <>
                <IconButton label="Correct this line" onClick={() => (setDraft(s.text), setMode("edit"))}>
                  <Pencil />
                </IconButton>
                {s.edited && (
                  <IconButton label="Restore original wording" onClick={() => patch({ revert: true })}>
                    <RotateCcw />
                  </IconButton>
                )}
                <IconButton
                  label={s.flaggedInaccurate ? "Unmark inaccurate" : "Mark inaccurate"}
                  pressed={s.flaggedInaccurate}
                  onClick={() => (s.flaggedInaccurate ? patch({ flaggedInaccurate: false }) : (setDraft(""), setMode("flag")))}
                >
                  <Flag />
                </IconButton>
              </>
            )}
          </div>
        )}
      </div>
    </li>
  );
});

function IconButton({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <Button type="button" variant="ghost" size="icon" className={cn("size-7 [&_svg]:size-3.5", pressed && "text-primary")} onClick={onClick} aria-label={label} aria-pressed={pressed} title={label}>
      {children}
    </Button>
  );
}

function LineEditor({
  value,
  onChange,
  onSave,
  onCancel,
  busy,
  label,
  small,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  label: string;
  small?: boolean;
}) {
  return (
    <div className="mt-1 space-y-1.5">
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        placeholder={label}
        rows={small ? 2 : 3}
        className="text-sm"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSave();
          if (e.key === "Escape") onCancel();
        }}
      />
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7" onClick={onSave} disabled={busy}>
          {busy && <Loader2 className="animate-spin" aria-hidden />} Save
        </Button>
        <Button size="sm" variant="outline" className="h-7" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Highlighted({ text, query }: { text: string; query: string }) {
  if (query.length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="rounded bg-yellow-300/70 px-0.5 text-inherit dark:bg-yellow-500/40">
            {p}
          </mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
