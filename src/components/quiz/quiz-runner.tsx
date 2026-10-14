"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, RotateCcw, Sparkles, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CitationChip } from "@/components/study-guide/citation-chip";
import { GuideMarkdown } from "@/components/study-guide/guide-markdown";
import { CLAIM_LABELS } from "@/components/study-guide/provenance";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Kbd, Progress } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { nextUndone } from "@/lib/navigation";
import type { ClaimLabel } from "@/lib/citations/markers";
import type { AnswerResult, QuestionView, QuizView, SessionSummary } from "@/lib/contracts/quiz";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import { draftFromResponse, emptyDraft, QuestionInput, toResponse, type Draft } from "./question-input";

const TYPE_LABEL: Record<QuestionView["type"], string> = {
  MULTIPLE_CHOICE: "Multiple choice",
  MULTI_SELECT: "Select all that apply",
  SHORT_ANSWER: "Short answer",
  NUMERICAL: "Numerical",
  ORDERING: "Put in order",
  MATCHING: "Matching",
};
const LEVEL = ["", "Recall", "Understanding", "Application", "Analysis", "Synthesis"];

function resultLabel(r: AnswerResult): ClaimLabel {
  if (r.claimType === "EXTERNAL") return "external";
  if (!r.anchors.length) return "unverified";
  return r.claimType === "INFERENCE" ? "inference" : "grounded";
}

type Phase = { kind: "loading" } | { kind: "resume"; quiz: QuizView } | { kind: "running" } | { kind: "summary"; summary: SessionSummary };

export function QuizRunner({ quizId, studySetId, onExit }: { quizId: string; studySetId: string; onExit: () => void }) {
  const qc = useQueryClient();
  const [quiz, setQuiz] = useState<QuizView | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [subset, setSubset] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [results, setResults] = useState<Record<string, AnswerResult>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownAt, setShownAt] = useState(Date.now());

  const start = useCallback(
    async (q: QuizView, ids: string[]) => {
      setError(null);
      try {
        const { sessionId } = await apiFetch<{ sessionId: string }>(`/api/quizzes/${q.id}/sessions`, { method: "POST" });
        setSessionId(sessionId);
        setSubset(ids);
        setIndex(0);
        setDrafts({});
        setResults({});
        setShownAt(Date.now());
        setPhase({ kind: "running" });
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : "Could not start the quiz.");
      }
    },
    [],
  );

  const resume = (q: QuizView) => {
    const s = q.session!;
    const done = Object.fromEntries(s.results.map((r) => [r.questionId, r]));
    const byId = new Map(q.questions.map((x) => [x.id, x]));
    setSessionId(s.id);
    setSubset(q.questions.map((x) => x.id));
    setResults(done);
    setDrafts(Object.fromEntries(s.results.map((r) => [r.questionId, draftFromResponse(byId.get(r.questionId)!, r.response)])));
    setIndex(Math.max(0, q.questions.findIndex((x) => !done[x.id])));
    setShownAt(Date.now());
    setPhase({ kind: "running" });
  };

  useEffect(() => {
    let cancelled = false;
    apiFetch<QuizView>(`/api/quizzes/${quizId}`)
      .then((q) => {
        if (cancelled) return;
        setQuiz(q);
        if (q.session && q.session.results.length > 0 && q.session.results.length < q.questions.length) setPhase({ kind: "resume", quiz: q });
        else void start(q, q.questions.map((x) => x.id));
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof ApiClientError ? err.message : "Could not load the quiz."));
    return () => {
      cancelled = true;
    };
  }, [quizId, start]);

  const byId = useMemo(() => new Map(quiz?.questions.map((q) => [q.id, q]) ?? []), [quiz]);
  const question = phase.kind === "running" ? byId.get(subset[index]!) : undefined;
  const draft = question ? (drafts[question.id] ?? emptyDraft(question)) : undefined;
  const result = question ? results[question.id] : undefined;
  const response = question && draft ? toResponse(question, draft) : null;
  const done = subset.map((id) => Boolean(results[id]));
  const answeredCount = done.filter(Boolean).length;
  const allAnswered = answeredCount === subset.length;

  const submit = useCallback(async () => {
    if (!question || !response || result || pending || !sessionId) return;
    setPending(true);
    setError(null);
    try {
      const r = await apiFetch<AnswerResult>(`/api/quiz-questions/${question.id}/answer`, {
        method: "POST",
        json: { sessionId, response, durationMs: Math.min(Date.now() - shownAt, 3_600_000) },
      });
      setResults((m) => ({ ...m, [question.id]: r }));
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not check your answer. Try again.");
    } finally {
      setPending(false);
    }
  }, [question, response, result, pending, sessionId, shownAt]);

  const finish = useCallback(async () => {
    if (!sessionId) return;
    setPending(true);
    try {
      const summary = await apiFetch<SessionSummary>(`/api/quiz-sessions/${sessionId}/finish`, { method: "POST" });
      setPhase({ kind: "summary", summary });
      void qc.invalidateQueries({ queryKey: ["quizzes", studySetId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not finish the quiz.");
    } finally {
      setPending(false);
    }
  }, [sessionId, qc, studySetId]);

  /** Free navigation with the arrows; unanswered questions can be skipped and come back. */
  const go = useCallback(
    (to: number) => {
      if (to < 0 || to >= subset.length) return;
      setIndex(to);
      setError(null);
      setShownAt(Date.now());
    },
    [subset.length],
  );

  /** After checking an answer: the next unanswered question, or the results when none is left. */
  const next = useCallback(() => {
    const to = nextUndone(done, index);
    if (to === -1) return void finish();
    go(to);
  }, [done, index, finish, go]);

  useEffect(() => {
    if (phase.kind !== "running" || !question) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
      // Arrow keys move between questions, except while editing an answer field.
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        go(index + (e.key === "ArrowLeft" ? -1 : 1));
        return;
      }
      if (e.key === "Enter" && (!typing || e.ctrlKey || e.metaKey || el?.tagName === "INPUT")) {
        if (el?.tagName === "BUTTON") return; // let the focused button handle it
        e.preventDefault();
        if (result) next();
        else void submit();
        return;
      }
      if (typing || result || e.ctrlKey || e.metaKey || e.altKey) return;
      if (question.options.kind === "choices" && /^[1-6]$/.test(e.key)) {
        const c = question.options.choices[Number(e.key) - 1];
        if (!c) return;
        const d = drafts[question.id] ?? emptyDraft(question);
        const multi = question.type === "MULTI_SELECT";
        setDrafts((m) => ({ ...m, [question.id]: { ...d, choices: multi ? (d.choices.includes(c.id) ? d.choices.filter((x) => x !== c.id) : [...d.choices, c.id]) : [c.id] } }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase.kind, question, result, drafts, next, submit, go, index]);

  if (error && !quiz) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (phase.kind === "loading" || !quiz) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading the quiz…
      </p>
    );
  }

  if (phase.kind === "resume") {
    const answered = phase.quiz.session!.results.length;
    return (
      <Card className="mx-auto max-w-xl">
        <CardContent className="space-y-4 pt-6">
          <p className="font-medium">You have an unfinished attempt ({answered} of {phase.quiz.questions.length} answered).</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => resume(phase.quiz)}>Continue where I left off</Button>
            <Button variant="outline" onClick={() => void start(phase.quiz, phase.quiz.questions.map((x) => x.id))}>
              Start over
            </Button>
            <Button variant="ghost" onClick={onExit}>
              Back
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (phase.kind === "summary") {
    return <Summary quiz={quiz} subset={subset} results={results} summary={phase.summary} studySetId={studySetId} onRetry={(ids) => void start(quiz, ids)} onExit={onExit} />;
  }

  if (!question || !draft) return null;
  const verdict = result ? (result.isCorrect ? "correct" : result.score > 0 ? "partial" : "incorrect") : null;
  const label = result ? resultLabel(result) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={answeredCount / subset.length} label="Questions answered" className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground">{answeredCount} answered</span>
        <Button variant="ghost" size="icon" onClick={onExit} aria-label="Leave the quiz (you can resume later)">
          <X aria-hidden />
        </Button>
      </div>

      <nav className="flex items-center justify-between gap-2" aria-label="Questions">
        <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous question">
          <ChevronLeft aria-hidden /> <span className="hidden sm:inline">Previous</span>
          <Kbd className="hidden sm:inline">←</Kbd>
        </Button>
        <span className="flex items-center gap-2 text-sm tabular-nums text-muted-foreground" aria-live="polite">
          Question {index + 1} of {subset.length}
          {result && (result.isCorrect ? <CheckCircle2 className="size-4 text-grounded" aria-label="answered correctly" /> : <XCircle className="size-4 text-destructive" aria-label="answered" />)}
        </span>
        <Button variant="outline" onClick={() => go(index + 1)} disabled={index >= subset.length - 1} aria-label="Next question">
          <Kbd className="hidden sm:inline">→</Kbd>
          <span className="hidden sm:inline">Next</span> <ChevronRight aria-hidden />
        </Button>
      </nav>

      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="muted">{TYPE_LABEL[question.type]}</Badge>
            {question.topic && <Badge variant="outline">{question.topic}</Badge>}
            <Badge variant="outline">{LEVEL[question.difficulty] ?? `Level ${question.difficulty}`}</Badge>
          </div>
          <div className="text-base leading-relaxed font-medium">
            <GuideMarkdown content={question.prompt} anchors={[]} studySetId={studySetId} />
          </div>
          <QuestionInput question={question} draft={draft} onChange={(d) => setDrafts((m) => ({ ...m, [question.id]: d }))} result={result} studySetId={studySetId} />
        </CardContent>
      </Card>

      {result && verdict && label && (
        <Card className={cn(verdict === "correct" ? "border-grounded" : verdict === "partial" ? "border-inference" : "border-destructive")}>
          <CardContent className="space-y-3 pt-5" aria-live="polite">
            <p className={cn("flex items-center gap-2 font-semibold", verdict === "correct" ? "text-grounded" : verdict === "partial" ? "text-inference" : "text-destructive")}>
              {verdict === "correct" ? <CheckCircle2 className="size-5" aria-hidden /> : <XCircle className="size-5" aria-hidden />}
              {verdict === "correct" ? "Correct" : verdict === "partial" ? `Partly correct (${Math.round(result.score * 100)}%)` : "Not quite"}
              {result.judged && (
                <Badge variant="muted" className="ml-1 font-normal">
                  <Sparkles aria-hidden /> Graded by AI
                </Badge>
              )}
            </p>
            {result.feedback && <p className="text-sm">{result.feedback}</p>}
            <div className="text-sm leading-relaxed">
              <GuideMarkdown content={result.explanation} anchors={[]} studySetId={studySetId} />
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Badge variant={CLAIM_LABELS[label].variant}>{CLAIM_LABELS[label].text}</Badge>
              {result.anchors.map((a, i) => (
                <CitationChip key={a.id} number={i + 1} label={label} anchors={[a]} studySetId={studySetId} />
              ))}
            </div>
            {result.warnings.map((w) => (
              <p key={w} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-inference" aria-hidden /> {w}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Finish early: only the answered questions count. */}
        {answeredCount > 0 && !allAnswered && (
          <Button variant="ghost" onClick={() => void finish()} disabled={pending}>
            Finish now ({subset.length - answeredCount} unanswered)
          </Button>
        )}
        {result ? (
          <Button onClick={next} disabled={pending} autoFocus>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {allAnswered ? "See results" : "Next unanswered"} <ArrowRight aria-hidden /> <Kbd className="bg-primary-foreground/20">Enter</Kbd>
          </Button>
        ) : (
          <Button onClick={() => void submit()} disabled={!response || pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {pending && question.type === "SHORT_ANSWER" ? "Checking your answer…" : "Check answer"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Summary({
  quiz,
  subset,
  results,
  summary,
  studySetId,
  onRetry,
  onExit,
}: {
  quiz: QuizView;
  subset: string[];
  results: Record<string, AnswerResult>;
  summary: SessionSummary;
  studySetId: string;
  onRetry: (ids: string[]) => void;
  onExit: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pct = Math.round(summary.score * 100);
  // Missed and skipped (finished early) questions can be retried together.
  const wrong = subset.filter((id) => !results[id]?.isCorrect);
  const skippedCount = subset.filter((id) => !results[id]).length;
  const byId = new Map(quiz.questions.map((q) => [q.id, q]));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{quiz.title}</p>
              <p className="text-4xl font-semibold tabular-nums">{pct}%</p>
              <p className="text-sm text-muted-foreground">
                {summary.correct} of {summary.answered} correct
                {summary.durationMs > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden /> {formatDuration(summary.durationMs / 1000)}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {wrong.length > 0 && (
                <Button onClick={() => onRetry(wrong)}>
                  <RotateCcw aria-hidden /> Retry the {wrong.length} I missed{skippedCount ? " or skipped" : ""}
                </Button>
              )}
              <Button variant="outline" onClick={() => onRetry(quiz.questions.map((q) => q.id))}>
                Retake the whole quiz
              </Button>
              <Button variant="ghost" onClick={onExit}>
                Back to quizzes
              </Button>
            </div>
          </div>

          {summary.byTopic.length > 1 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">By topic (weakest first)</p>
              {summary.byTopic.map((t) => (
                <div key={t.topic} className="grid grid-cols-[minmax(0,1fr)_120px_48px] items-center gap-3 text-sm">
                  <span className="truncate">{t.topic}</span>
                  <Progress value={t.score} label={`${t.topic} score`} />
                  <span className="text-right tabular-nums text-muted-foreground">
                    {t.correct}/{t.answered}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ul className="space-y-2" aria-label="Your answers">
        {subset.map((id, i) => {
          const q = byId.get(id);
          const r = results[id];
          if (!q || !r) return null;
          const expanded = open === id;
          return (
            <li key={id} className="rounded-lg border bg-card">
              <button type="button" className="flex w-full items-start gap-3 p-3 text-left text-sm" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : id)}>
                {r.isCorrect ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-grounded" aria-label="Correct" /> : <XCircle className={cn("mt-0.5 size-4 shrink-0", r.score > 0 ? "text-inference" : "text-destructive")} aria-label="Incorrect" />}
                <span className="w-5 shrink-0 text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="pointer-events-none line-clamp-2 min-w-0 flex-1 [&_p]:my-0">
                  <GuideMarkdown content={q.prompt} anchors={[]} studySetId={studySetId} />
                </span>
              </button>
              {expanded && (
                <div className="space-y-3 border-t p-3">
                  <QuestionInput question={q} draft={draftFromResponse(q, r.response)} onChange={() => {}} result={r} studySetId={studySetId} />
                  {r.feedback && <p className="text-sm">{r.feedback}</p>}
                  <div className="text-sm text-muted-foreground">
                    <GuideMarkdown content={r.explanation} anchors={[]} studySetId={studySetId} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
