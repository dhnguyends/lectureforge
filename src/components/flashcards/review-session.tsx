"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent, Kbd, Progress } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { nextUndone } from "@/lib/navigation";
import type { QueueCard, ReviewQueue, ReviewResult } from "@/lib/contracts/flashcards";
import type { Rating } from "@/lib/srs/fsrs";
import { cn } from "@/lib/utils";
import { CardBack, CardFront } from "./card-face";

const BUTTONS: { rating: Rating; label: string; key: string; className: string }[] = [
  { rating: "AGAIN", label: "Again", key: "1", className: "border-destructive/40 text-destructive hover:bg-destructive/10" },
  { rating: "HARD", label: "Hard", key: "2", className: "border-inference/40 text-inference hover:bg-inference-bg" },
  { rating: "GOOD", label: "Good", key: "3", className: "border-grounded/40 text-grounded hover:bg-grounded-bg" },
  { rating: "EASY", label: "Easy", key: "4", className: "border-primary/40 text-primary hover:bg-primary/10" },
];
const RATING_LABEL: Record<Rating, string> = { AGAIN: "Again", HARD: "Hard", GOOD: "Good", EASY: "Easy" };
const RATING_BADGE: Record<Rating, "destructive" | "inference" | "grounded" | "default"> = { AGAIN: "destructive", HARD: "inference", GOOD: "grounded", EASY: "default" };

const TYPE_LABEL: Record<QueueCard["type"], string> = {
  BASIC: "Question",
  CLOZE: "Fill in the blank",
  EQUATION: "Equation",
  IMAGE_LABEL: "Image",
  CODE_COMPLETION: "Code",
  CONCEPTUAL: "Concept",
};

type Item = QueueCard & { repeat: boolean };

/** Next card without an answer after `from`, wrapping round to the start; -1 when all are answered. */
export function nextUnanswered(answers: (Rating | undefined)[], length: number, from: number): number {
  return nextUndone(Array.from({ length }, (_, i) => Boolean(answers[i])), from);
}

export function ReviewSession({ studySetId, onExit }: { studySetId: string; onExit: () => void }) {
  const qc = useQueryClient();
  const [queue, setQueue] = useState<Item[] | null>(null);
  const [index, setIndex] = useState(0);
  /** The answer given to each position of the queue in this session. */
  const [answers, setAnswers] = useState<(Rating | undefined)[]>([]);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  /** Answers still being saved. */
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());

  const load = useCallback(async () => {
    setQueue(null);
    setIndex(0);
    setAnswers([]);
    setRevealed(new Set());
    setError(null);
    try {
      const q = await apiFetch<ReviewQueue>(`/api/study-sets/${studySetId}/flashcards/review`);
      setQueue(q.cards.map((c) => ({ ...c, repeat: false })));
      shownAt.current = Date.now();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not load the review queue.");
      setQueue([]);
    }
  }, [studySetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = queue?.length ?? 0;
  const answeredCount = answers.filter(Boolean).length;
  const card = queue?.[index];
  const answer = answers[index];
  const isRevealed = Boolean(answer) || revealed.has(index);
  const finished = queue !== null && (total === 0 || (answeredCount === total && pending === 0));

  const go = useCallback(
    (to: number) => {
      if (!queue || to < 0 || to >= queue.length) return;
      setIndex(to);
      shownAt.current = Date.now();
    },
    [queue],
  );
  const reveal = useCallback(() => setRevealed((s) => new Set(s).add(index)), [index]);

  // Answers are saved in the background so the next card appears at once; a
  // failed save puts the card back in the queue to be answered again.
  const rate = useCallback(
    (rating: Rating) => {
      if (!card || !queue || answers[index]) return;
      setError(null);
      const nextAnswers = [...answers];
      nextAnswers[index] = rating;
      // A forgotten card comes back at the end of this session.
      const length = queue.length + (rating === "AGAIN" ? 1 : 0);
      if (rating === "AGAIN") setQueue((q) => (q ? [...q, { ...card, repeat: true }] : q));
      setAnswers(nextAnswers);
      // The queue may have just grown (Again), so move by index directly rather than through go().
      const next = nextUnanswered(nextAnswers, length, index);
      if (next !== -1) setIndex(next);
      const durationMs = Math.min(Date.now() - shownAt.current, 3_600_000);
      shownAt.current = Date.now();
      setPending((n) => n + 1);
      apiFetch<ReviewResult>(`/api/flashcards/${card.id}/review`, { method: "POST", json: { rating, durationMs } })
        .catch((err: unknown) => {
          setError(`${err instanceof ApiClientError ? err.message : "Your answer could not be saved."} The card was put back in the queue.`);
          setQueue((q) => (q ? [...q, { ...card, repeat: true }] : q));
        })
        .finally(() => setPending((n) => n - 1));
    },
    [card, queue, answers, index],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(index - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(index + 1);
      } else if (!isRevealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal();
      } else if (isRevealed && !answer) {
        const b = BUTTONS.find((x) => x.key === e.key);
        if (b) {
          e.preventDefault();
          rate(b.rating);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, isRevealed, answer, go, reveal, rate]);

  // Refresh the counts on the overview when the session ends.
  useEffect(() => {
    if (finished) void qc.invalidateQueries({ queryKey: ["flashcards", studySetId] });
  }, [finished, qc, studySetId]);

  if (queue === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading your review…
      </p>
    );
  }

  if (finished) {
    const tally = answers.reduce<Record<Rating, number>>((t, a) => (a ? { ...t, [a]: t[a] + 1 } : t), { AGAIN: 0, HARD: 0, GOOD: 0, EASY: 0 });
    return (
      <Card>
        <CardContent className="space-y-4 pt-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-grounded" aria-hidden />
          <div>
            <p className="text-lg font-semibold">{answeredCount ? "Session complete" : "Nothing to review right now"}</p>
            <p className="text-sm text-muted-foreground">
              {answeredCount
                ? `${answeredCount} answers — ${tally.AGAIN} again, ${tally.HARD} hard, ${tally.GOOD} good, ${tally.EASY} easy.`
                : "All cards are scheduled for later. Come back when they are due."}
            </p>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => void load()}>
              <RotateCcw aria-hidden /> Check for more
            </Button>
            <Button onClick={onExit}>Done</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const remaining = total - answeredCount;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Progress value={answeredCount / total} label="Cards answered" className="flex-1" />
        <span className="text-xs tabular-nums text-muted-foreground">{answeredCount} answered</span>
        <Button variant="ghost" size="icon" onClick={onExit} aria-label="End review">
          <X aria-hidden />
        </Button>
      </div>

      <nav className="flex items-center justify-between gap-2" aria-label="Cards">
        <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous card">
          <ChevronLeft aria-hidden /> <span className="hidden sm:inline">Previous</span>
          <Kbd className="hidden sm:inline">←</Kbd>
        </Button>
        <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          Card {index + 1} of {total}
        </span>
        <Button variant="outline" onClick={() => go(index + 1)} disabled={index >= total - 1} aria-label="Next card">
          <Kbd className="hidden sm:inline">→</Kbd>
          <span className="hidden sm:inline">Next</span> <ChevronRight aria-hidden />
        </Button>
      </nav>

      {card && (
        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="muted">{TYPE_LABEL[card.type]}</Badge>
              {!card.review && !card.repeat && <Badge variant="default">New</Badge>}
              {card.repeat && <Badge variant="inference">Again</Badge>}
              {card.tags.slice(0, 3).map((t) => (
                <Badge key={t} variant="outline">
                  {t}
                </Badge>
              ))}
              {answer && (
                <Badge variant={RATING_BADGE[answer]} className="ml-auto">
                  You answered: {RATING_LABEL[answer]}
                </Badge>
              )}
            </div>

            <div aria-live="polite">{card.type !== "CLOZE" || !isRevealed ? <CardFront card={card} studySetId={studySetId} /> : null}</div>

            {isRevealed ? (
              <div className={cn(card.type !== "CLOZE" && "border-t pt-4")}>
                <CardBack card={card} studySetId={studySetId} />
              </div>
            ) : (
              <Button className="w-full" size="lg" onClick={reveal}>
                Show answer <Kbd className="bg-primary-foreground/20">Space</Kbd>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {card && isRevealed && !answer && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="How well did you remember?">
          {BUTTONS.map((b) => (
            <Button key={b.rating} variant="outline" className={cn("h-auto flex-col gap-0.5 py-2", b.className)} onClick={() => rate(b.rating)}>
              <span className="font-semibold">{b.label}</span>
              <span className="text-xs opacity-80">
                {card.repeat ? " " : card.intervals[b.rating]} <Kbd className="ml-1">{b.key}</Kbd>
              </span>
            </Button>
          ))}
        </div>
      )}

      {answer && (
        <p className="text-center text-sm text-muted-foreground">
          Already answered — this card is scheduled. {remaining > 0 ? `${remaining} card${remaining === 1 ? "" : "s"} still to answer.` : ""}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
