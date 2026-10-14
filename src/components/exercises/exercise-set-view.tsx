"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  Eye,
  Lightbulb,
  ListChecks,
  Loader2,
  Send,
  ShieldCheck,
  Shuffle,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CitationChip } from "@/components/study-guide/citation-chip";
import { GuideMarkdown } from "@/components/study-guide/guide-markdown";
import { CLAIM_LABELS } from "@/components/study-guide/provenance";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Input, Kbd, Label, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { ClaimLabel } from "@/lib/citations/markers";
import type { ExerciseSetView as SetView, ExerciseType, ExerciseView, SolutionView, SubmissionResult, TierName, Verdict } from "@/lib/contracts/exercises";
import { cn } from "@/lib/utils";

const TIER_LABEL: Record<TierName, string> = { easy: "Easy", intermediate: "Intermediate", difficult: "Difficult" };
const TIER_STYLE: Record<TierName, string> = { easy: "bg-grounded-bg text-grounded", intermediate: "bg-inference-bg text-inference", difficult: "bg-destructive/10 text-destructive" };
const TYPE_LABEL: Record<ExerciseType, string> = {
  DERIVATION: "Derivation",
  QUANTITATIVE: "Calculation",
  PROOF: "Proof",
  ALGORITHM_DESIGN: "Algorithm design",
  CODE_DEBUGGING: "Debugging",
  CONCEPTUAL_TRANSFER: "Concept transfer",
  PAPER_CRITIQUE: "Critique",
  CASE_ANALYSIS: "Case analysis",
};
const VERDICT: Record<Verdict, { text: string; tone: "good" | "mid" | "bad" }> = {
  correct: { text: "Correct", tone: "good" },
  mostly_correct: { text: "Mostly correct", tone: "good" },
  partially_correct: { text: "Partly correct", tone: "mid" },
  incorrect: { text: "Not yet", tone: "bad" },
  off_topic: { text: "Off topic", tone: "bad" },
};
const TONE = { good: "text-grounded border-grounded", mid: "text-inference border-inference", bad: "text-destructive border-destructive" };

function claimLabel(e: Pick<ExerciseView, "claimType">, anchors: number): ClaimLabel {
  if (e.claimType === "EXTERNAL") return "external";
  if (!anchors) return "unverified";
  return e.claimType === "INFERENCE" ? "inference" : "grounded";
}

type Draft = { text: string; finalAnswer: string; hints: string[] };

export function ExerciseSetView({ exerciseSetId, studySetId, onExit }: { exerciseSetId: string; studySetId: string; onExit: () => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["exercise-set", exerciseSetId], queryFn: () => apiFetch<SetView>(`/api/exercise-sets/${exerciseSetId}`) });
  const [index, setIndex] = useState<number | null>(null);
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ["exercise-set", exerciseSetId] }), [qc, exerciseSetId]);

  if (query.isLoading || !query.data) {
    return query.error ? (
      <p role="alert" className="text-sm text-destructive">
        Could not load the exercises.
      </p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the exercises…
      </p>
    );
  }
  const set = query.data;
  if (index !== null && set.exercises[index]) {
    return <Workspace set={set} index={index} onIndex={setIndex} studySetId={studySetId} onRefresh={refresh} onList={() => setIndex(null)} />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onExit}>
          <ArrowLeft aria-hidden /> All exercise sets
        </Button>
        <p className="text-sm text-muted-foreground">{set.title}</p>
      </div>
      {(["easy", "intermediate", "difficult"] as const).map((tier) => {
        const items = set.exercises.map((e, i) => ({ e, i })).filter(({ e }) => e.tier === tier);
        if (!items.length) return null;
        return (
          <section key={tier} aria-labelledby={`tier-${tier}`} className="space-y-2">
            <h2 id={`tier-${tier}`} className="flex items-center gap-2 text-base font-semibold">
              <span className={cn("rounded-md px-2 py-0.5 text-xs", TIER_STYLE[tier])}>{TIER_LABEL[tier]}</span>
              <span className="text-sm font-normal text-muted-foreground">{items.length} exercises</span>
            </h2>
            <ul className="space-y-2">
              {items.map(({ e, i }) => (
                <li key={e.id}>
                  <button type="button" onClick={() => setIndex(i)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left hover:bg-accent">
                    <Status e={e} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{e.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {TYPE_LABEL[e.type]} · about {e.estimatedMinutes} min{e.grounding === "TRANSFER" ? " · new situation" : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {e.progress.bestScore !== null ? `${Math.round(e.progress.bestScore * 100)}%` : e.progress.solutionRevealed ? "solution seen" : "not started"}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Status({ e }: { e: ExerciseView }) {
  const best = e.progress.bestScore;
  if (best !== null && best >= 0.8) return <CheckCircle2 className="size-5 shrink-0 text-grounded" aria-label="Done" />;
  if (best !== null) return <CircleDashed className="size-5 shrink-0 text-inference" aria-label="Attempted" />;
  if (e.progress.solutionRevealed) return <Eye className="size-5 shrink-0 text-muted-foreground" aria-label="Solution seen" />;
  return <CircleDashed className="size-5 shrink-0 text-muted-foreground/50" aria-label="Not started" />;
}

function Workspace({
  set,
  index,
  onIndex,
  studySetId,
  onRefresh,
  onList,
}: {
  set: SetView;
  index: number;
  onIndex: (i: number) => void;
  studySetId: string;
  onRefresh: () => Promise<void>;
  onList: () => void;
}) {
  const e = set.exercises[index]!;
  const total = set.exercises.length;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draft: Draft = drafts[e.id] ?? { text: e.progress.last?.text ?? "", finalAnswer: e.progress.last?.finalAnswerCheck?.given ?? "", hints: e.hintsRevealed };
  const setDraft = (d: Partial<Draft>) => setDrafts((m) => ({ ...m, [e.id]: { ...draft, ...d } }));
  const [result, setResult] = useState<Record<string, SubmissionResult>>({});
  const [solution, setSolution] = useState<Record<string, SolutionView>>({});
  const [busy, setBusy] = useState<"grade" | "hint" | "solution" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const startedAt = useRef(Date.now());

  const shownResult = result[e.id] ?? e.progress.last;
  const shownSolution = solution[e.id] ?? e.solution;

  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= total) return;
      onIndex(to);
      setError(null);
      setPreview(false);
      startedAt.current = Date.now();
    },
    [total, onIndex],
  );

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === "ArrowLeft") go(index - 1);
      if (ev.key === "ArrowRight") go(index + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index]);

  const nextHint = async () => {
    setBusy("hint");
    setError(null);
    try {
      const h = await apiFetch<{ index: number; text: string }>(`/api/exercises/${e.id}/hint`, { method: "POST", json: { index: draft.hints.length } });
      setDraft({ hints: [...draft.hints, h.text] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load the hint.");
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    setBusy("grade");
    setError(null);
    try {
      const r = await apiFetch<SubmissionResult>(`/api/exercises/${e.id}/submit`, {
        method: "POST",
        json: {
          text: draft.text,
          ...(e.hasFinalAnswer && draft.finalAnswer.trim() ? { finalAnswer: draft.finalAnswer.trim() } : {}),
          hintsUsed: draft.hints.length,
          durationMs: Date.now() - startedAt.current,
        },
      });
      setResult((m) => ({ ...m, [e.id]: r }));
      void onRefresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Your answer could not be graded. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const reveal = async () => {
    if (!shownResult && !window.confirm("Show the worked solution? Trying first (with a hint if needed) helps you learn much more.")) return;
    setBusy("solution");
    setError(null);
    try {
      const s = await apiFetch<SolutionView>(`/api/exercises/${e.id}/solution`, { method: "POST", json: { hintsUsed: draft.hints.length } });
      setSolution((m) => ({ ...m, [e.id]: s }));
      void onRefresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load the solution.");
    } finally {
      setBusy(null);
    }
  };

  const md = (text: string) => <GuideMarkdown content={text} anchors={[]} studySetId={studySetId} />;
  const verdict = shownResult ? VERDICT[shownResult.verdict] : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={onList}>
          <ArrowLeft aria-hidden /> All exercises
        </Button>
        <span className="text-xs text-muted-foreground">{set.title}</span>
      </div>

      <nav className="flex items-center justify-between gap-2" aria-label="Exercises">
        <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous exercise">
          <ChevronLeft aria-hidden /> <span className="hidden sm:inline">Previous</span>
          <Kbd className="hidden sm:inline">←</Kbd>
        </Button>
        <span className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground" aria-live="polite">
          Exercise {index + 1} of {total}
          <span className={cn("rounded-md px-1.5 py-0.5 text-xs", TIER_STYLE[e.tier])}>{TIER_LABEL[e.tier]}</span>
        </span>
        <Button variant="outline" onClick={() => go(index + 1)} disabled={index >= total - 1} aria-label="Next exercise">
          <Kbd className="hidden sm:inline">→</Kbd>
          <span className="hidden sm:inline">Next</span> <ChevronRight aria-hidden />
        </Button>
      </nav>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{TYPE_LABEL[e.type]}</Badge>
            <Badge variant="outline">
              <Clock aria-hidden /> about {e.estimatedMinutes} min
            </Badge>
            {e.grounding === "TRANSFER" && (
              <Badge variant="practice">
                <Shuffle aria-hidden /> Applies the material to a new situation
              </Badge>
            )}
            {e.progress.attempts > 0 && (
              <Badge variant="outline">
                {e.progress.attempts} attempt{e.progress.attempts === 1 ? "" : "s"} · best {Math.round((e.progress.bestScore ?? 0) * 100)}%
              </Badge>
            )}
          </div>
          <h2 className="text-xl font-semibold tracking-tight">{e.title}</h2>
          <div className="leading-relaxed">{md(e.statement)}</div>

          <details className="rounded-lg bg-muted/40 p-3 text-sm" open={index === 0}>
            <summary className="cursor-pointer font-medium">What is expected</summary>
            <dl className="mt-2 space-y-2">
              <div>
                <dt className="font-medium">Answer format</dt>
                <dd className="text-muted-foreground">{e.expectedFormat}</dd>
              </div>
              {e.learningObjective && (
                <div>
                  <dt className="font-medium">Learning objective</dt>
                  <dd className="text-muted-foreground">{e.learningObjective}</dd>
                </div>
              )}
              {e.prerequisites.length > 0 && (
                <div>
                  <dt className="font-medium">You need</dt>
                  <dd className="text-muted-foreground">{e.prerequisites.join(" · ")}</dd>
                </div>
              )}
              {e.assumptions.length > 0 && (
                <div>
                  <dt className="font-medium">Assumptions</dt>
                  <dd className="text-muted-foreground">
                    <ul className="list-disc pl-5">
                      {e.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          </details>

          {e.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3 shrink-0 text-inference" aria-hidden /> {w}
            </p>
          ))}

          {draft.hints.length > 0 && (
            <ol className="space-y-2" aria-label="Hints">
              {draft.hints.map((h, i) => (
                <li key={i} className="flex gap-2 rounded-lg border border-inference/30 bg-inference-bg/40 p-3 text-sm">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-inference" aria-hidden />
                  <span className="min-w-0 [&_p]:my-0">
                    <span className="font-medium">Hint {i + 1}. </span>
                    {md(h)}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {draft.hints.length < e.hintCount && !shownSolution && (
            <Button variant="outline" size="sm" onClick={() => void nextHint()} disabled={busy !== null}>
              {busy === "hint" ? <Loader2 className="animate-spin" aria-hidden /> : <Lightbulb aria-hidden />}
              Show hint {draft.hints.length + 1} of {e.hintCount}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`answer-${e.id}`}>Your answer</Label>
            <button type="button" className="text-xs text-primary underline-offset-4 hover:underline" onClick={() => setPreview((p) => !p)}>
              {preview ? "Edit" : "Preview math"}
            </button>
          </div>
          {preview ? (
            <div className="min-h-32 rounded-md border p-3 text-sm leading-relaxed">{draft.text.trim() ? md(draft.text) : <span className="text-muted-foreground">Nothing written yet.</span>}</div>
          ) : (
            <Textarea
              id={`answer-${e.id}`}
              rows={9}
              maxLength={20_000}
              value={draft.text}
              onChange={(ev) => setDraft({ text: ev.target.value })}
              placeholder="Work it out here. Markdown and LaTeX ($x^2$, $$\frac{a}{b}$$) are supported."
            />
          )}
          {e.hasFinalAnswer && (
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`final-${e.id}`} className="shrink-0">
                Final answer
              </Label>
              <Input id={`final-${e.id}`} className="max-w-48" inputMode="decimal" value={draft.finalAnswer} onChange={(ev) => setDraft({ finalAnswer: ev.target.value })} placeholder="e.g. 0.25" />
              {e.finalAnswerUnit && <span className="text-sm text-muted-foreground">{e.finalAnswerUnit}</span>}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void submit()} disabled={busy !== null || !draft.text.trim()}>
              {busy === "grade" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
              {busy === "grade" ? "Grading your answer…" : shownResult ? "Submit revised answer" : "Submit for feedback"}
            </Button>
            {!shownSolution && (
              <Button variant="outline" onClick={() => void reveal()} disabled={busy !== null}>
                {busy === "solution" ? <Loader2 className="animate-spin" aria-hidden /> : <BookOpenCheck aria-hidden />}
                Show solution
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {shownResult && verdict && (
        <Card className={cn("border", TONE[verdict.tone].split(" ")[1])}>
          <CardContent className="space-y-3 pt-5" aria-live="polite">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={cn("flex items-center gap-2 text-lg font-semibold", TONE[verdict.tone].split(" ")[0])}>
                {verdict.tone === "good" ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
                {verdict.text} · {Math.round(shownResult.score * 100)}%
              </p>
              {shownResult.finalAnswerCheck && (
                <span className={cn("text-sm", shownResult.finalAnswerCheck.correct ? "text-grounded" : "text-destructive")}>
                  Final answer {shownResult.finalAnswerCheck.given}: {shownResult.finalAnswerCheck.correct ? "correct" : "not correct"}
                </span>
              )}
            </div>
            <p className="text-sm">{shownResult.feedback}</p>
            {shownResult.strengths.length > 0 && (
              <ul className="space-y-1 text-sm">
                {shownResult.strengths.map((s) => (
                  <li key={s} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-grounded" aria-hidden /> {s}
                  </li>
                ))}
              </ul>
            )}
            {shownResult.gaps.length > 0 && (
              <ul className="space-y-1 text-sm">
                {shownResult.gaps.map((s) => (
                  <li key={s} className="flex gap-2">
                    <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden /> {s}
                  </li>
                ))}
              </ul>
            )}
            {shownResult.misconceptions.length > 0 && (
              <p className="flex gap-2 rounded-md bg-inference-bg/50 p-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-inference" aria-hidden />
                <span>
                  <span className="font-medium">Watch out: </span>
                  {shownResult.misconceptions.join(" ")}
                </span>
              </p>
            )}
            {shownResult.nextStep && (
              <p className="text-sm">
                <span className="font-medium">Next step: </span>
                {shownResult.nextStep}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {shownSolution && <Solution s={shownSolution} e={e} studySetId={studySetId} />}

      <nav className="flex justify-between gap-2 pb-6" aria-label="Exercises (bottom)">
        <Button variant="ghost" onClick={() => go(index - 1)} disabled={index === 0}>
          <ChevronLeft aria-hidden /> Previous exercise
        </Button>
        <Button variant="ghost" onClick={() => go(index + 1)} disabled={index >= total - 1}>
          Next exercise <ChevronRight aria-hidden />
        </Button>
      </nav>
    </div>
  );
}

function Solution({ s, e, studySetId }: { s: SolutionView; e: ExerciseView; studySetId: string }) {
  const label = claimLabel(e, s.anchors.length);
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <BookOpenCheck className="size-5 text-primary" aria-hidden /> Worked solution
        </h3>
        <div className="leading-relaxed">
          <GuideMarkdown content={s.solution} anchors={[]} studySetId={studySetId} />
        </div>
        {s.finalAnswer && (
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">Final answer:</span> {s.finalAnswer.value}
            {s.finalAnswer.tolerance > 0 && <span className="text-muted-foreground">(± {Number(s.finalAnswer.tolerance.toPrecision(3))})</span>} {s.finalAnswer.unit}
            {s.check === "agreed" && (
              <Badge variant="grounded">
                <ShieldCheck aria-hidden /> Double-checked by an independent calculation
              </Badge>
            )}
            {s.check === "disagreed" && (
              <Badge variant="destructive">
                <AlertTriangle aria-hidden /> An independent calculation disagreed — check it
              </Badge>
            )}
          </p>
        )}
        {s.rubric.length > 0 && (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="size-4" aria-hidden /> A complete answer…
            </p>
            <ul className="list-disc space-y-0.5 pl-6 text-sm text-muted-foreground">
              {s.rubric.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Badge variant={CLAIM_LABELS[label].variant}>{CLAIM_LABELS[label].text}</Badge>
          {s.anchors.map((a, i) => (
            <CitationChip key={a.id} number={i + 1} label={label} anchors={[a]} studySetId={studySetId} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
