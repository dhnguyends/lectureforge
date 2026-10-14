"use client";

import { ArrowDown, ArrowUp, Check, X } from "lucide-react";
import { GuideMarkdown } from "@/components/study-guide/guide-markdown";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import type { AnswerResult, QuestionView } from "@/lib/contracts/quiz";
import type { QuestionResponse } from "@/lib/quiz/grade";
import { cn } from "@/lib/utils";

/** What the learner has entered so far, before it becomes a QuestionResponse. */
export type Draft = { choices: string[]; order: string[]; pairs: Record<string, string>; text: string };

export function emptyDraft(q: QuestionView): Draft {
  return { choices: [], order: q.options.kind === "ordering" ? q.options.items.map((i) => i.id) : [], pairs: {}, text: "" };
}

export function toResponse(q: QuestionView, d: Draft): QuestionResponse | null {
  switch (q.type) {
    case "MULTIPLE_CHOICE":
      return d.choices[0] ? { kind: "single", choice: d.choices[0] } : null;
    case "MULTI_SELECT":
      return d.choices.length ? { kind: "multi", choices: d.choices } : null;
    case "ORDERING":
      return { kind: "ordering", order: d.order };
    case "MATCHING":
      return q.options.kind === "matching" && q.options.left.every((l) => d.pairs[l.id]) ? { kind: "matching", pairs: d.pairs } : null;
    case "NUMERICAL":
      return d.text.trim() ? { kind: "numerical", value: d.text.trim() } : null;
    case "SHORT_ANSWER":
      return d.text.trim() ? { kind: "text", text: d.text.trim() } : null;
  }
}

/** Rebuilds the draft from a stored answer, to show what was answered. */
export function draftFromResponse(q: QuestionView, r: QuestionResponse): Draft {
  const d = emptyDraft(q);
  if (r.kind === "single") d.choices = [r.choice];
  if (r.kind === "multi") d.choices = r.choices;
  if (r.kind === "ordering") d.order = r.order;
  if (r.kind === "matching") d.pairs = r.pairs;
  if (r.kind === "numerical") d.text = r.value;
  if (r.kind === "text") d.text = r.text;
  return d;
}

const LETTER = ["A", "B", "C", "D", "E", "F"];

export function QuestionInput({
  question,
  draft,
  onChange,
  result,
  studySetId,
}: {
  question: QuestionView;
  draft: Draft;
  onChange: (d: Draft) => void;
  result: AnswerResult | undefined;
  studySetId: string;
}) {
  const locked = Boolean(result);
  const o = question.options;
  const md = (text: string) => <GuideMarkdown content={text} anchors={[]} studySetId={studySetId} />;

  if (o.kind === "choices") {
    const multi = question.type === "MULTI_SELECT";
    const answer = result?.answer;
    const correct = new Set(answer?.kind === "single" ? [answer.correct] : answer?.kind === "multi" ? answer.correct : []);
    const toggle = (id: string) => {
      if (locked) return;
      onChange({ ...draft, choices: multi ? (draft.choices.includes(id) ? draft.choices.filter((c) => c !== id) : [...draft.choices, id]) : [id] });
    };
    return (
      <div role={multi ? "group" : "radiogroup"} aria-label="Answer options" className="space-y-2">
        {o.choices.map((c, i) => {
          const chosen = draft.choices.includes(c.id);
          const isRight = locked && correct.has(c.id);
          const isWrong = locked && chosen && !correct.has(c.id);
          const why = locked && !correct.has(c.id) ? result?.distractorRationale?.[c.id] : undefined;
          return (
            <div key={c.id}>
              <button
                type="button"
                role={multi ? "checkbox" : "radio"}
                aria-checked={chosen}
                disabled={locked}
                onClick={() => toggle(c.id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition-colors disabled:cursor-default",
                  !locked && (chosen ? "border-primary bg-primary/5" : "hover:bg-accent"),
                  isRight && "border-grounded bg-grounded-bg",
                  isWrong && "border-destructive bg-destructive/10",
                  locked && !isRight && !isWrong && "opacity-70",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center border text-xs font-semibold",
                    multi ? "rounded" : "rounded-full",
                    chosen && !locked && "border-primary bg-primary text-primary-foreground",
                  )}
                  aria-hidden
                >
                  {isRight ? <Check className="size-3.5 text-grounded" /> : isWrong ? <X className="size-3.5 text-destructive" /> : LETTER[i]}
                </span>
                <span className="min-w-0 flex-1 [&_p]:my-0">{md(c.text)}</span>
              </button>
              {why && (chosen || question.type === "MULTI_SELECT") && <p className="mt-1 ml-9 text-xs text-muted-foreground">{why}</p>}
            </div>
          );
        })}
        {!locked && <p className="text-xs text-muted-foreground">{multi ? "Select all that apply." : "Press 1–" + o.choices.length + " to choose."}</p>}
      </div>
    );
  }

  if (o.kind === "ordering") {
    const byId = new Map(o.items.map((i) => [i.id, i]));
    const correctOrder = result?.answer.kind === "ordering" ? result.answer.order : null;
    const move = (from: number, to: number) => {
      if (locked || to < 0 || to >= draft.order.length) return;
      const next = [...draft.order];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item!);
      onChange({ ...draft, order: next });
    };
    return (
      <div className="space-y-3">
        <ol className="space-y-2" aria-label="Items in your order">
          {draft.order.map((id, i) => {
            const right = correctOrder ? correctOrder[i] === id : null;
            return (
              <li key={id} className={cn("flex items-center gap-2 rounded-lg border p-2 text-sm", right === true && "border-grounded bg-grounded-bg", right === false && "border-destructive bg-destructive/10")}>
                <span className="w-6 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 [&_p]:my-0">{md(byId.get(id)?.text ?? "")}</span>
                {!locked && (
                  <span className="flex shrink-0">
                    <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === draft.order.length - 1} onClick={() => move(i, i + 1)}>
                      <ArrowDown aria-hidden />
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        {correctOrder && !result?.isCorrect && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <p className="mb-1 font-medium">Correct order</p>
            <ol className="list-decimal space-y-0.5 pl-5">
              {correctOrder.map((id) => (
                <li key={id} className="[&_p]:my-0">
                  {md(byId.get(id)?.text ?? "")}
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    );
  }

  if (o.kind === "matching") {
    // Right-hand items are listed once with letters (rendered, so math shows);
    // each row picks a letter, since a native <select> cannot render math.
    const letterOf = new Map(o.right.map((r, i) => [r.id, LETTER[i]!]));
    const rightText = new Map(o.right.map((r) => [r.id, r.text]));
    const plain = (t: string) => (t.includes("$") || t.includes("\\") ? "" : ` — ${t.length > 60 ? `${t.slice(0, 57)}…` : t}`);
    const pairs = result?.answer.kind === "matching" ? result.answer.pairs : null;
    const answerCell = (id: string | undefined) =>
      id ? (
        <span className="flex items-start gap-1.5 [&_p]:my-0">
          <span className="font-semibold">{letterOf.get(id)}.</span> {md(rightText.get(id) ?? "")}
        </span>
      ) : (
        "—"
      );
    return (
      <div className="space-y-3">
        <ol className="grid gap-1.5 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2" aria-label="Answers to match">
          {o.right.map((r, i) => (
            <li key={r.id} className="flex items-start gap-1.5 [&_p]:my-0">
              <span className="font-semibold">{LETTER[i]}.</span> {md(r.text)}
            </li>
          ))}
        </ol>
        {o.left.map((l) => {
          const chosen = draft.pairs[l.id] ?? "";
          const right = pairs ? pairs[l.id] === chosen : null;
          return (
            <div key={l.id} className={cn("grid gap-2 rounded-lg border p-2 text-sm sm:grid-cols-2 sm:items-center", right === true && "border-grounded bg-grounded-bg", right === false && "border-destructive bg-destructive/10")}>
              <span className="[&_p]:my-0">{md(l.text)}</span>
              {locked ? (
                <span className="space-y-1">
                  {answerCell(chosen || undefined)}
                  {right === false && pairs && (
                    <span className="flex items-start gap-1 text-xs text-grounded">
                      Correct: {answerCell(pairs[l.id])}
                    </span>
                  )}
                </span>
              ) : (
                <NativeSelect aria-label={`Match for ${l.text}`} value={chosen} onChange={(e) => onChange({ ...draft, pairs: { ...draft.pairs, [l.id]: e.target.value } })}>
                  <option value="">Choose…</option>
                  {o.right.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      {LETTER[i]}
                      {plain(r.text)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (o.kind === "numerical") {
    const a = result?.answer.kind === "numerical" ? result.answer : null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            aria-label="Your answer"
            inputMode="decimal"
            autoComplete="off"
            value={draft.text}
            disabled={locked}
            onChange={(e) => onChange({ ...draft, text: e.target.value })}
            className={cn("max-w-56", result && (result.isCorrect ? "border-grounded" : "border-destructive"))}
          />
          {o.unit && <span className="text-sm text-muted-foreground">{o.unit}</span>}
        </div>
        {a && !result?.isCorrect && (
          <p className="text-sm">
            Correct answer: <strong>{a.value}</strong>
            {a.tolerance > 0 && <span className="text-muted-foreground"> (± {a.tolerance})</span>} {a.unit}
          </p>
        )}
      </div>
    );
  }

  const model = result?.answer.kind === "text" ? result.answer.modelAnswer : null;
  return (
    <div className="space-y-2">
      <Textarea
        aria-label="Your answer"
        rows={3}
        maxLength={2000}
        value={draft.text}
        disabled={locked}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        placeholder="Type your answer…"
      />
      {!locked && <p className="text-xs text-muted-foreground">Ctrl+Enter to submit.</p>}
      {model && (
        <div className="rounded-lg bg-muted/50 p-3 text-sm">
          <p className="mb-1 font-medium">Model answer</p>
          <div className="[&_p]:my-0">{md(model)}</div>
        </div>
      )}
    </div>
  );
}
