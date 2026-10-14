"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BookOpenCheck, Loader2, Sparkles } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, NativeSelect, Progress } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { GuideStyleWire, GuideView, StudyGuidesResponse } from "@/lib/contracts/study-guide";
import { cn } from "@/lib/utils";
import { SectionCard } from "./section-card";

const STYLES: { value: GuideStyleWire; label: string; hint: string }[] = [
  { value: "DETAILED_NOTES", label: "Detailed lecture notes", hint: "Full explanations in the order taught" },
  { value: "EXAM_REVISION", label: "Concise exam revision", hint: "Key facts, equations and traps" },
  { value: "TECHNICAL_OUTLINE", label: "Technical outline", hint: "Hierarchical bullets and definitions" },
  { value: "CORNELL", label: "Cornell notes", hint: "Cues, notes and summary" },
  { value: "PAPER_READING", label: "Research-paper reading notes", hint: "Method, assumptions, results, limits" },
];

const STATUS: Record<GuideView["status"], { text: string; variant: "muted" | "default" | "grounded" | "inference" | "destructive" }> = {
  DRAFT: { text: "Draft", variant: "muted" },
  GENERATING: { text: "Generating", variant: "default" },
  READY: { text: "Ready", variant: "grounded" },
  NEEDS_REVIEW: { text: "Needs review", variant: "inference" },
  FAILED: { text: "Failed", variant: "destructive" },
};

export function StudyGuideView({
  studySetId,
  canEdit,
  initialList,
  initialGuide,
}: {
  studySetId: string;
  canEdit: boolean;
  initialList: StudyGuidesResponse;
  initialGuide: GuideView | null;
}) {
  const list = useQuery({
    queryKey: ["study-guides", studySetId],
    queryFn: () => apiFetch<StudyGuidesResponse>(`/api/study-sets/${studySetId}/study-guides`),
    initialData: initialList,
    refetchInterval: (q) => (q.state.data?.activeJobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 2500 : false),
  });
  const [selectedId, setSelectedId] = useState<string | null>(initialGuide?.id ?? null);
  const guides = list.data?.guides ?? [];
  const latestId = guides[0]?.id ?? null;

  // Follow a newly created guide version.
  const [seenLatest, setSeenLatest] = useState(latestId);
  useEffect(() => {
    if (latestId && latestId !== seenLatest) {
      setSelectedId(latestId);
      setSeenLatest(latestId);
    }
  }, [latestId, seenLatest]);

  const activeJobs = (list.data?.activeJobs ?? []).filter((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const guideJob = activeJobs.find((j) => j.type === "GENERATE_STUDY_GUIDE");
  const failedGuideJob = (list.data?.activeJobs ?? []).find((j) => j.type === "GENERATE_STUDY_GUIDE" && j.status === "FAILED");
  const regenerating = new Set(activeJobs.flatMap((j) => (j.type === "REGENERATE_ITEM" && j.sectionId ? [j.sectionId] : [])));

  const guide = useQuery({
    queryKey: ["study-guide", selectedId],
    queryFn: () => apiFetch<GuideView>(`/api/study-guides/${selectedId}`),
    enabled: Boolean(selectedId),
    initialData: selectedId === initialGuide?.id ? (initialGuide ?? undefined) : undefined,
    refetchInterval: (q) => (q.state.data?.status === "GENERATING" || regenerating.size > 0 ? 2500 : false),
  });

  // When a regeneration finishes, the list stops polling; refresh the guide once more.
  const qc = useQueryClient();
  const regenKey = [...regenerating].sort().join(",");
  useEffect(() => {
    if (!regenKey) void qc.invalidateQueries({ queryKey: ["study-guide", selectedId] });
  }, [regenKey, qc, selectedId]);

  const g = guide.data;

  return (
    <div className="space-y-6">
      {(!g || !selectedId) && (
        <GeneratePanel studySetId={studySetId} canEdit={canEdit} list={list.data} busy={Boolean(guideJob)} />
      )}

      {guideJob && (
        <Card>
          <CardContent className="space-y-2 pt-5" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {guideJob.status === "QUEUED" ? "Waiting to start…" : (guideJob.message ?? "Generating…")}
            </p>
            <Progress value={guideJob.progress} label="Study guide generation progress" />
            <p className="text-xs text-muted-foreground">Each section is written from your sources, then every citation is checked against the source text.</p>
          </CardContent>
        </Card>
      )}

      {failedGuideJob && !guideJob && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" aria-hidden /> The last generation failed: {failedGuideJob.error}
        </p>
      )}

      {g && (
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside aria-label="Guide contents" className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            {guides.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-semibold tracking-wide text-muted-foreground uppercase" htmlFor="guide-version">
                  Version
                </label>
                <NativeSelect id="guide-version" value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
                  {guides.map((v) => (
                    <option key={v.id} value={v.id} suppressHydrationWarning>
                      {new Date(v.createdAt).toLocaleString()} · {STYLES.find((s) => s.value === v.style)?.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <nav aria-label="Sections">
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contents</h2>
              <ol className="space-y-1 text-sm">
                {g.sections.map((s) => (
                  <li key={s.id} className={cn(s.parentId && "pl-3")}>
                    <a href={`#section-${s.id}`} className="block rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            {canEdit && <GeneratePanel studySetId={studySetId} canEdit={canEdit} list={list.data} busy={Boolean(guideJob)} compact />}
          </aside>

          <article aria-labelledby="guide-title" className="min-w-0 space-y-4">
            <header className="flex flex-wrap items-center gap-2">
              <h2 id="guide-title" className="mr-auto text-xl font-semibold tracking-tight">
                {g.title}
              </h2>
              <Badge variant={STATUS[g.status].variant}>{STATUS[g.status].text}</Badge>
              <Badge variant="outline">{STYLES.find((s) => s.value === g.style)?.label}</Badge>
            </header>
            <p className="text-xs text-muted-foreground">
              AI-generated from your sources{g.model ? ` with ${g.model}` : ""}. Numbered chips show where each statement comes from; select one to see the
              exact excerpt.
            </p>
            {g.sections.map((s) => (
              <SectionCard
                key={s.id}
                section={s}
                guideId={g.id}
                studySetId={studySetId}
                canEdit={canEdit}
                pending={g.status === "GENERATING" && !s.content}
                regenerating={regenerating.has(s.id)}
              />
            ))}
          </article>
        </div>
      )}
    </div>
  );
}

function GeneratePanel({
  studySetId,
  canEdit,
  list,
  busy,
  compact = false,
}: {
  studySetId: string;
  canEdit: boolean;
  list: StudyGuidesResponse | undefined;
  busy: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [style, setStyle] = useState<GuideStyleWire>("DETAILED_NOTES");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();

  const blocked = !list?.aiConfigured
    ? "AI generation is not configured on this server yet."
    : !list.readySources
      ? "Add a source and wait for it to finish processing first."
      : !canEdit
        ? "You have view-only access to this study set."
        : null;

  const generate = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/study-sets/${studySetId}/study-guides`, { method: "POST", json: { style } });
      await qc.invalidateQueries({ queryKey: ["study-guides", studySetId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start generation.");
    } finally {
      setPending(false);
    }
  };

  const controls = (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Style
        </label>
        <NativeSelect id={id} value={style} onChange={(e) => setStyle(e.target.value as GuideStyleWire)} disabled={busy}>
          {STYLES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label} — {s.hint}
            </option>
          ))}
        </NativeSelect>
      </div>
      {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button onClick={generate} disabled={Boolean(blocked) || busy || pending} className={cn(compact && "w-full")}>
        {pending || busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
        {compact ? "Generate new version" : "Generate study guide"}
      </Button>
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-2 border-t pt-4">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">New version</h2>
        {controls}
      </div>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpenCheck className="size-5 text-primary" aria-hidden /> Study guide
        </CardTitle>
        <CardDescription>
          A structured guide built only from your sources: objectives, vocabulary, equations with a symbol glossary, concepts, misconceptions and
          recall prompts. Every statement links to the moment or page it came from.
        </CardDescription>
      </CardHeader>
      <CardContent>{controls}</CardContent>
    </Card>
  );
}
