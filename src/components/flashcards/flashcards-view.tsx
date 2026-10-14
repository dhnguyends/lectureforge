"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Layers, Loader2, Pause, Pencil, Play, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalDate } from "@/components/ui/local-date";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Label, NativeSelect, Progress, Textarea } from "@/components/ui/primitives";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import type { CardsResponse, CardView, FlashcardsOverview } from "@/lib/contracts/flashcards";
import { cn } from "@/lib/utils";
import { CardBack, CardFront, cardLabel } from "./card-face";
import { ReviewSession } from "./review-session";

const COUNTS = [
  { value: "", label: "Automatic (sized to your material)" },
  { value: "20", label: "About 20 cards" },
  { value: "40", label: "About 40 cards" },
  { value: "80", label: "About 80 cards" },
  { value: "150", label: "About 150 cards" },
];

export function FlashcardsView({ studySetId, canEdit, initial }: { studySetId: string; canEdit: boolean; initial: FlashcardsOverview }) {
  const qc = useQueryClient();
  const overview = useQuery({
    queryKey: ["flashcards", studySetId],
    queryFn: () => apiFetch<FlashcardsOverview>(`/api/study-sets/${studySetId}/flashcards`),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.activeJobs.some((j) => j.status === "QUEUED" || j.status === "RUNNING") ? 2500 : false),
  });
  const [mode, setMode] = useState<"overview" | "review">("overview");
  const data = overview.data;
  const job = data.activeJobs.find((j) => j.status === "QUEUED" || j.status === "RUNNING");
  const failed = data.activeJobs.find((j) => j.status === "FAILED");

  // A finished generation adds cards: refresh the list once the job is gone.
  const jobId = job?.id ?? null;
  useEffect(() => {
    if (!jobId) void qc.invalidateQueries({ queryKey: ["flashcards-cards", studySetId] });
  }, [jobId, qc, studySetId]);

  if (mode === "review") return <ReviewSession studySetId={studySetId} onExit={() => setMode("overview")} />;

  const { counts } = data;
  const toStudy = counts.due + counts.newToday;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Layers className="size-5" aria-hidden /> Spaced repetition
            </CardTitle>
            <CardDescription>
              Cards come back just before you would forget them (FSRS scheduling). Answer honestly: “Again” brings a card back in a few minutes.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Due now" value={counts.due} highlight={counts.due > 0} />
              <Stat label="New today" value={counts.newToday} />
              <Stat label="Learned" value={counts.learned} />
              <Stat label="Total cards" value={counts.total} />
            </dl>
            <Button size="lg" onClick={() => setMode("review")} disabled={toStudy === 0}>
              <Play aria-hidden /> {toStudy > 0 ? `Study now (${toStudy})` : "Nothing due right now"}
            </Button>
          </CardContent>
        </Card>
        <GeneratePanel studySetId={studySetId} canEdit={canEdit} overview={data} busy={Boolean(job)} />
      </div>

      {job && (
        <Card>
          <CardContent className="space-y-2 pt-5" aria-live="polite">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {job.status === "QUEUED" ? "Waiting to start…" : (job.message ?? "Writing cards…")}
            </p>
            <Progress value={job.progress} label="Flashcard generation progress" />
            <p className="text-xs text-muted-foreground">Every card is checked against a verbatim excerpt of your sources; cards that cannot be matched are removed or flagged.</p>
          </CardContent>
        </Card>
      )}
      {failed && !job && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4" aria-hidden /> The last generation failed: {failed.error}
        </p>
      )}

      {data.decks.some((d) => d.cards > 0) && <CardBrowser studySetId={studySetId} canEdit={canEdit} overview={data} />}
    </div>
  );
}

function Stat({ label, value, highlight = false }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-2xl font-semibold tabular-nums", highlight && "text-primary")}>{value}</dd>
    </div>
  );
}

function GeneratePanel({ studySetId, canEdit, overview, busy }: { studySetId: string; canEdit: boolean; overview: FlashcardsOverview; busy: boolean }) {
  const qc = useQueryClient();
  const [count, setCount] = useState("");
  const [focus, setFocus] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const countId = useId();
  const focusId = useId();

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
      await apiFetch(`/api/study-sets/${studySetId}/flashcards`, {
        method: "POST",
        json: { ...(count ? { count: Number(count) } : {}), ...(focus.trim() ? { focus: focus.trim() } : {}) },
      });
      setFocus("");
      await qc.invalidateQueries({ queryKey: ["flashcards", studySetId] });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not start generation.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{overview.counts.total > 0 ? "Generate more cards" : "Generate flashcards"}</CardTitle>
        <CardDescription>Written from your sources, each with a citation you can open.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={countId}>Number of cards</Label>
          <NativeSelect id={countId} value={count} onChange={(e) => setCount(e.target.value)} disabled={busy}>
            {COUNTS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={focusId}>Focus on a topic (optional)</Label>
          <Input id={focusId} value={focus} onChange={(e) => setFocus(e.target.value)} maxLength={200} placeholder="e.g. transition matrices" disabled={busy} />
        </div>
        {blocked && <p className="text-sm text-muted-foreground">{blocked}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button onClick={generate} disabled={Boolean(blocked) || busy || pending} className="w-full">
          {pending || busy ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
          {busy ? "Generating…" : "Generate"}
        </Button>
      </CardContent>
    </Card>
  );
}

function CardBrowser({ studySetId, canEdit, overview }: { studySetId: string; canEdit: boolean; overview: FlashcardsOverview }) {
  const qc = useQueryClient();
  const [deckId, setDeckId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardView | null>(null);
  const deckSelect = useId();
  const cards = useQuery({
    queryKey: ["flashcards-cards", studySetId, deckId],
    queryFn: () => apiFetch<CardsResponse>(`/api/study-sets/${studySetId}/flashcards/cards${deckId ? `?deckId=${deckId}` : ""}`),
  });

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: ["flashcards-cards", studySetId] }), qc.invalidateQueries({ queryKey: ["flashcards", studySetId] })]);
  };
  const suspend = async (c: CardView) => {
    await apiFetch(`/api/flashcards/${c.id}`, { method: "PATCH", json: { suspended: !c.suspended } });
    await refresh();
  };
  const remove = async (c: CardView) => {
    if (!window.confirm("Delete this card? Its review history is deleted too.")) return;
    await apiFetch(`/api/flashcards/${c.id}`, { method: "DELETE" });
    await refresh();
  };
  const removeDeck = async () => {
    const deck = overview.decks.find((d) => d.id === deckId);
    if (!deck || !window.confirm(`Delete the deck “${deck.title}” and its ${deck.cards} cards?`)) return;
    await apiFetch(`/api/flashcard-decks/${deck.id}`, { method: "DELETE" });
    setDeckId("");
    await refresh();
  };

  return (
    <section className="space-y-3" aria-labelledby="all-cards">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="all-cards" className="text-lg font-semibold">
          All cards
        </h2>
        <div className="flex items-end gap-2">
          {overview.decks.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor={deckSelect} className="text-xs text-muted-foreground">
                Deck
              </Label>
              <NativeSelect id={deckSelect} value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                <option value="">All decks ({overview.decks.reduce((n, d) => n + d.cards, 0)})</option>
                {overview.decks.map((d) => (
                  <option key={d.id} value={d.id} suppressHydrationWarning>
                    {new Date(d.createdAt).toLocaleDateString()} · {d.title} ({d.cards})
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {canEdit && deckId && (
            <Button variant="outline" size="sm" onClick={() => void removeDeck()}>
              <Trash2 aria-hidden /> Delete deck
            </Button>
          )}
        </div>
      </div>

      {cards.isLoading && <p className="text-sm text-muted-foreground">Loading cards…</p>}
      <ul className="space-y-2">
        {cards.data?.cards.map((c) => {
          const expanded = open === c.id;
          const label = cardLabel(c);
          return (
            <li key={c.id} className={cn("rounded-lg border bg-card", c.suspended && "opacity-60")}>
              <div className="flex items-start gap-3 p-3">
                <button type="button" className="min-w-0 flex-1 text-left" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : c.id)}>
                  <div className="pointer-events-none line-clamp-3 text-sm">
                    <CardFront card={c} studySetId={studySetId} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {c.review ? (
                      <Badge variant="muted">{c.review.state === "REVIEW" ? (
                          <>
                            due <LocalDate iso={c.review.due} />
                          </>
                        ) : (
                          c.review.state.toLowerCase()
                        )}</Badge>
                    ) : (
                      <Badge variant="muted">new</Badge>
                    )}
                    {label !== "grounded" && <Badge variant={label === "unverified" ? "destructive" : label === "external" ? "practice" : "inference"}>{label}</Badge>}
                    {c.suspended && <Badge variant="outline">suspended</Badge>}
                    {c.editedByUser && <Badge variant="outline">edited</Badge>}
                  </div>
                </button>
                {canEdit && (
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" aria-label="Edit card" onClick={() => setEditing(c)}>
                      <Pencil aria-hidden />
                    </Button>
                    <Button variant="ghost" size="icon" aria-label={c.suspended ? "Resume card" : "Suspend card"} onClick={() => void suspend(c)}>
                      {c.suspended ? <Play aria-hidden /> : <Pause aria-hidden />}
                    </Button>
                    <Button variant="ghost" size="icon" aria-label="Delete card" onClick={() => void remove(c)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              {expanded && (
                <div className="border-t p-3">
                  <CardBack card={c} studySetId={studySetId} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <EditCardDialog card={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </section>
  );
}

function EditCardDialog({ card, onClose, onSaved }: { card: CardView; onClose: () => void; onSaved: () => Promise<void> }) {
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frontId = useId();
  const backId = useId();

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await apiFetch(`/api/flashcards/${card.id}`, { method: "PATCH", json: { front, back } });
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not save the card.");
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit card</DialogTitle>
          <DialogDescription>
            Markdown and LaTeX ($…$) work.{card.type === "CLOZE" ? " Mark the hidden part as {{c1::answer}}." : ""} Your review schedule is kept.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor={frontId}>Front</Label>
            <Textarea id={frontId} value={front} onChange={(e) => setFront(e.target.value)} rows={4} maxLength={1200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={backId}>Back</Label>
            <Textarea id={backId} value={back} onChange={(e) => setBack(e.target.value)} rows={4} maxLength={2400} />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={pending || !front.trim()}>
            {pending && <Loader2 className="animate-spin" aria-hidden />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
