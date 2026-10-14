"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Play, Puzzle, Sparkles, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalDate } from "@/components/ui/local-date";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Progress } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { ExerciseSetListItem, ExercisesOverview, TierName } from "@/lib/contracts/exercises";
import { cn } from "@/lib/utils";
import { ExerciseSetView } from "./exercise-set-view";

export const TIER_LABEL: Record<TierName, string> = { easy: "Easy", intermediate: "Intermediate", difficult: "Difficult" };
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function ExercisesView({ studySetId, canEdit, initial }: { studySetId: string; canEdit: boolean; initial: ExercisesOverview }) {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["exercises", studySetId],
    queryFn: () => apiFetch<ExercisesOverview>(`/api/study-sets/${studySetId}/exercises`),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.activeJobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 2500 : false),
  });
  const [active, setActive] = useState<string | null>(null);
  const data = overview.data;
  const job = data.activeJobs.find((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const failed = data.activeJobs.find((j) => j.status === "FAILED");

  if (active) {
    return (
      <ExerciseSetView
        exerciseSetId={active}
        studySetId={studySetId}
        onExit={() => {
          setActive(null);
          void qc.invalidateQueries({ queryKey: ["exercises", studySetId] });
        }}
      />
    );
  }

  const remove = async (s: ExerciseSetListItem) => {
    if (!window.confirm(`Delete “${s.title}” and your answers to it?`)) return;
    await apiFetch(`/api/exercise-sets/${s.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["exercises", studySetId] });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="space-y-3" aria-labelledby="ex-list">
        <h2 id="ex-list" className="flex items-center gap-2 text-lg font-semibold">
          <Puzzle className="size-5" aria-hidden /> Exercise sets
        </h2>
        {job && (
          <Card>
            <CardContent className="space-y-2 pt-5" aria-live="polite">
              <p className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {job.status === "QUEUED" ? "Waiting to start…" : (job.message ?? "Writing exercises…")}
              </p>
              <Progress value={job.progress} label="Exercise generation progress" />
              <p className="text-xs text-muted-foreground">
                Each exercise gets hints, a worked solution and a grading rubric; numerical answers are re-computed independently, and source citations are checked word for word.
              </p>
            </CardContent>
          </Card>
        )}
        {failed && !job && (
          <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden /> The last generation failed: {failed.error}
          </p>
        )}
        {data.sets.length === 0 && !job && <p className="text-sm text-muted-foreground">No exercises yet. Generate a set from your sources.</p>}
        <ul className="space-y-2">
          {data.sets.map((s) => (
            <li key={s.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-4 pt-5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate font-medium">{s.title}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        {(["easy", "intermediate", "difficult"] as const)
                          .filter((t) => s.counts[t])
                          .map((t) => `${s.counts[t]} ${TIER_LABEL[t].toLowerCase()}`)
                          .join(" · ")}{" "}
                        · <LocalDate iso={s.createdAt} />
                      </span>
                      {s.status === "NEEDS_REVIEW" && <Badge variant="inference">Some exercises flagged</Badge>}
                    </p>
                  </div>
                  <dl className="flex gap-4 text-center text-xs">
                    <div>
                      <dt className="text-muted-foreground">Done</dt>
                      <dd className="text-base font-semibold tabular-nums">
                        {s.progress.attempted}/{s.progress.total}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Average</dt>
                      <dd className={cn("text-base font-semibold tabular-nums", s.progress.averageBest !== null && s.progress.averageBest >= 0.8 && "text-grounded")}>{pct(s.progress.averageBest)}</dd>
                    </div>
                  </dl>
                  <div className="flex gap-1">
                    <Button onClick={() => setActive(s.id)}>
                      <Play aria-hidden /> {s.progress.attempted ? "Continue" : "Start"}
                    </Button>
                    {canEdit && (
                      <Button variant="ghost" size="icon" aria-label={`Delete ${s.title}`} onClick={() => void remove(s)}>
                        <Trash2 aria-hidden />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <GeneratePanel studySetId={studySetId} canEdit={canEdit} overview={data} busy={Boolean(job)} />
    </div>
  );
}

function GeneratePanel({ studySetId, canEdit, overview, busy }: { studySetId: string; canEdit: boolean; overview: ExercisesOverview; busy: boolean }) {
  const qc = useQueryClient();
  const [counts, setCounts] = useState<Record<TierName, number>>({ easy: 5, intermediate: 5, difficult: 2 });
  const [focus, setFocus] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const focusId = useId();
  const baseId = useId();
  const total = counts.easy + counts.intermediate + counts.difficult;

  const blocked = !overview.aiConfigured
    ? "AI generation is not configured on this server yet."
    : !overview.readySources
      ? "Add a source and wait for it to finish processing first."
      : !canEdit
        ? "You have view-only access to this study set."
        : null;

  const generate = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/study-sets/${studySetId}/exercises`, { method: "POST", json: { ...counts, ...(focus.trim() ? { focus: focus.trim() } : {}) } });
      setFocus("");
      await qc.invalidateQueries({ queryKey: ["exercises", studySetId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start generation.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="text-base">Generate exercises</CardTitle>
        <CardDescription>Worked problems from your sources, with hints, solutions and AI feedback on your answers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          {(["easy", "intermediate", "difficult"] as const).map((t) => (
            <div key={t} className="space-y-1.5">
              <Label htmlFor={`${baseId}-${t}`}>{TIER_LABEL[t]}</Label>
              <NativeSelect id={`${baseId}-${t}`} value={counts[t]} disabled={busy} onChange={(e) => setCounts((c) => ({ ...c, [t]: Number(e.target.value) }))}>
                {Array.from({ length: 11 }, (_, n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Easy: one idea, 5–15 min · Intermediate: several steps, 15–30 min · Difficult: exam level, 30–60 min.
        </p>
        <div className="space-y-1.5">
          <Label htmlFor={focusId}>Focus on a topic (optional)</Label>
          <Input id={focusId} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="e.g. regime forecasting" disabled={busy} />
        </div>
        {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={generate} disabled={Boolean(blocked) || busy || pending || total === 0} className="w-full">
          {pending || busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {busy ? "Generating…" : `Generate ${total} exercise${total === 1 ? "" : "s"}`}
        </Button>
      </CardContent>
    </Card>
  );
}
