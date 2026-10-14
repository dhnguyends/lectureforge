"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ListChecks, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalDate } from "@/components/ui/local-date";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Progress } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { QUIZ_QUESTION_TYPES, type QuizDifficultyWire, type QuizListItem, type QuizQuestionType, type QuizzesOverview } from "@/lib/contracts/quiz";
import { cn } from "@/lib/utils";
import { QuizRunner } from "./quiz-runner";

const DIFFICULTIES: { value: QuizDifficultyWire; label: string }[] = [
  { value: "foundational", label: "Foundational — recall and understanding" },
  { value: "mixed", label: "Mixed — recall to analysis" },
  { value: "challenging", label: "Challenging — application and analysis" },
];

const TYPE_NAMES: Record<QuizQuestionType, string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  MULTI_SELECT: "Select all",
  SHORT_ANSWER: "Short answer",
  NUMERICAL: "Numerical",
  ORDERING: "Ordering",
  MATCHING: "Matching",
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

export function QuizView({ studySetId, canEdit, initial }: { studySetId: string; canEdit: boolean; initial: QuizzesOverview }) {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["quizzes", studySetId],
    queryFn: () => apiFetch<QuizzesOverview>(`/api/study-sets/${studySetId}/quizzes`),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.activeJobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 2500 : false),
  });
  const [active, setActive] = useState<string | null>(null);
  const data = overview.data;
  const job = data.activeJobs.find((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const failed = data.activeJobs.find((j) => j.status === "FAILED");

  if (active) {
    return (
      <QuizRunner
        quizId={active}
        studySetId={studySetId}
        onExit={() => {
          setActive(null);
          void qc.invalidateQueries({ queryKey: ["quizzes", studySetId] });
        }}
      />
    );
  }

  const remove = async (q: QuizListItem) => {
    if (!window.confirm(`Delete “${q.title}” and all attempts at it?`)) return;
    await apiFetch(`/api/quizzes/${q.id}`, { method: "DELETE" });
    await qc.invalidateQueries({ queryKey: ["quizzes", studySetId] });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-3" aria-labelledby="quiz-list">
          <h2 id="quiz-list" className="flex items-center gap-2 text-lg font-semibold">
            <ListChecks className="size-5" aria-hidden /> Quizzes
          </h2>
          {job && (
            <Card>
              <CardContent className="space-y-2 pt-5" aria-live="polite">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> {job.status === "QUEUED" ? "Waiting to start…" : (job.message ?? "Writing questions…")}
                </p>
                <Progress value={job.progress} label="Quiz generation progress" />
                <p className="text-xs text-muted-foreground">Each question is checked: its source excerpt must appear word for word, and malformed or duplicate questions are removed.</p>
              </CardContent>
            </Card>
          )}
          {failed && !job && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="size-4" aria-hidden /> The last generation failed: {failed.error}
            </p>
          )}
          {data.quizzes.length === 0 && !job && <p className="text-sm text-muted-foreground">No quizzes yet. Generate one from your sources.</p>}
          <ul className="space-y-2">
            {data.quizzes.map((q) => (
              <li key={q.id}>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4 pt-5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate font-medium">{q.title}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>
                          {q.questionCount} questions · {q.difficulty} · <LocalDate iso={q.createdAt} />
                        </span>
                        {q.status === "NEEDS_REVIEW" && <Badge variant="inference">Some questions unverified</Badge>}
                        {q.inProgress && <Badge variant="default">In progress</Badge>}
                      </p>
                    </div>
                    <dl className="flex gap-4 text-center text-xs">
                      <div>
                        <dt className="text-muted-foreground">Last</dt>
                        <dd className={cn("text-base font-semibold tabular-nums", q.lastScore !== null && (q.lastScore >= 0.8 ? "text-grounded" : q.lastScore < 0.5 ? "text-destructive" : ""))}>{pct(q.lastScore)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Best</dt>
                        <dd className="text-base font-semibold tabular-nums">{pct(q.bestScore)}</dd>
                      </div>
                    </dl>
                    <div className="flex gap-1">
                      <Button onClick={() => setActive(q.id)} disabled={q.questionCount === 0}>
                        <Play aria-hidden /> {q.inProgress ? "Continue" : q.attempts ? "Take again" : "Start"}
                      </Button>
                      {canEdit && (
                        <Button variant="ghost" size="icon" aria-label={`Delete ${q.title}`} onClick={() => void remove(q)}>
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
    </div>
  );
}

function GeneratePanel({ studySetId, canEdit, overview, busy }: { studySetId: string; canEdit: boolean; overview: QuizzesOverview; busy: boolean }) {
  const qc = useQueryClient();
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState<QuizDifficultyWire>("mixed");
  const [types, setTypes] = useState<QuizQuestionType[]>([...QUIZ_QUESTION_TYPES]);
  const [focus, setFocus] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = { count: useId(), difficulty: useId(), focus: useId() };

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
      await apiFetch(`/api/study-sets/${studySetId}/quizzes`, {
        method: "POST",
        json: { count, difficulty, types, ...(focus.trim() ? { focus: focus.trim() } : {}) },
      });
      setFocus("");
      await qc.invalidateQueries({ queryKey: ["quizzes", studySetId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start generation.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle className="text-base">Generate a quiz</CardTitle>
        <CardDescription>Questions written from your sources, with explanations and citations.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={ids.count}>Questions</Label>
          <NativeSelect id={ids.count} value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={busy}>
            {[5, 10, 15, 20, 30].map((n) => (
              <option key={n} value={n}>
                {n} questions
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.difficulty}>Difficulty</Label>
          <NativeSelect id={ids.difficulty} value={difficulty} onChange={(e) => setDifficulty(e.target.value as QuizDifficultyWire)} disabled={busy}>
            {DIFFICULTIES.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">Question types</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {QUIZ_QUESTION_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={types.includes(t)}
                  disabled={busy}
                  onChange={(e) => setTypes((cur) => (e.target.checked ? [...cur, t] : cur.filter((x) => x !== t)))}
                />
                {TYPE_NAMES[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={ids.focus}>Focus on a topic (optional)</Label>
          <Input id={ids.focus} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="e.g. stationary distributions" disabled={busy} />
        </div>
        {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={generate} disabled={Boolean(blocked) || busy || pending || types.length === 0} className="w-full">
          {pending || busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {busy ? "Generating…" : "Generate quiz"}
        </Button>
      </CardContent>
    </Card>
  );
}
