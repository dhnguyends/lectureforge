import type { CardReviewState, Prisma, StudySet } from "@prisma/client";
import { audit } from "@/lib/audit";
import type { CardView, DeckView, FlashcardsOverview, QueueCard, ReviewQueue, ReviewResult } from "@/lib/contracts/flashcards";
import type { AnchorView, JobView } from "@/lib/contracts/study-guide";
import { db } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { formatInterval, newCard, RATINGS, schedule, scheduleAll, type Rating, type SrsCard } from "@/lib/srs/fsrs";
import { requireStudySet } from "@/server/authz";
import { isAiConfigured } from "@/server/generation/run";
import { createAndEnqueueJob } from "./jobs";
import { NEW_CARDS_PER_DAY } from "./study-sets";

type Actor = { id: string; ip?: string };
const ACTIVE = ["QUEUED", "RUNNING"] as const;
const QUEUE_LIMIT = 100;

const cardInclude = (userId: string) =>
  ({
    anchors: { include: { source: { select: { title: true, kind: true } } }, orderBy: { createdAt: "asc" } },
    reviewStates: { where: { userId } },
  }) satisfies Prisma.FlashcardInclude;
type CardRow = Prisma.FlashcardGetPayload<{ include: ReturnType<typeof cardInclude> }>;

function toView(c: CardRow): CardView {
  const r = c.reviewStates[0];
  return {
    id: c.id,
    deckId: c.deckId,
    type: c.type,
    front: c.front,
    back: c.back,
    tags: c.tags,
    claimType: c.claimType,
    confidence: c.confidence,
    warnings: c.warnings,
    learningObjective: c.learningObjective,
    suspended: c.suspended,
    editedByUser: c.editedByUser,
    anchors: c.anchors.map(
      (a): AnchorView => ({
        id: a.id,
        claimKey: a.claimKey,
        sourceId: a.sourceId,
        sourceTitle: a.source.title,
        sourceKind: a.source.kind,
        startMs: a.startMs,
        endMs: a.endMs,
        page: a.page,
        excerpt: a.excerpt,
        verified: a.verified,
      }),
    ),
    review: r ? { state: r.state, due: r.due.toISOString(), reps: r.reps, lapses: r.lapses } : null,
  };
}

function toSrs(r: CardReviewState | undefined, now: Date): SrsCard {
  if (!r) return newCard(now);
  return {
    state: r.state,
    due: r.due,
    stability: r.stability,
    difficulty: r.difficulty,
    elapsedDays: r.elapsedDays,
    scheduledDays: r.scheduledDays,
    reps: r.reps,
    lapses: r.lapses,
    lastReviewedAt: r.lastReviewedAt,
  };
}

function startOfToday(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** New cards this user may still start today in this set (daily limit). */
async function newAllowance(userId: string, studySetId: string): Promise<number> {
  const startedToday = await db.attempt.count({
    where: {
      userId,
      kind: "FLASHCARD_REVIEW",
      createdAt: { gte: startOfToday() },
      response: { path: ["previousState"], equals: "NEW" },
      flashcard: { deck: { studySetId } },
    },
  });
  return Math.max(0, NEW_CARDS_PER_DAY - startedToday);
}

async function activeJobs(studySetId: string): Promise<JobView[]> {
  const jobs = await db.generationJob.findMany({
    where: {
      studySetId,
      type: "GENERATE_FLASHCARDS",
      OR: [{ status: { in: [...ACTIVE] } }, { status: "FAILED", finishedAt: { gte: new Date(Date.now() - 3600_000) } }],
    },
    orderBy: { queuedAt: "desc" },
    take: 5,
    include: { events: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  return jobs.map((j) => ({
    id: j.id,
    type: j.type,
    status: j.status,
    progress: j.progress,
    error: j.error,
    message: j.events[0]?.message ?? null,
    sectionId: null,
  }));
}

export async function getFlashcardsOverview(userId: string, studySetId: string): Promise<FlashcardsOverview> {
  const now = new Date();
  const [decks, jobs, readySources, allowance, counts] = await Promise.all([
    db.flashcardDeck.findMany({
      where: { studySetId },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { cards: true } }, cards: { where: { suspended: true }, select: { id: true } } },
    }),
    activeJobs(studySetId),
    db.source.count({ where: { studySetId, status: "READY" } }),
    newAllowance(userId, studySetId),
    db.$queryRaw<{ total: bigint; due: bigint; unseen: bigint }[]>`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE r."flashcardId" IS NOT NULL AND r.due <= ${now}) AS due,
             COUNT(*) FILTER (WHERE r."flashcardId" IS NULL) AS unseen
      FROM "Flashcard" f
      JOIN "FlashcardDeck" d ON d.id = f."deckId"
      LEFT JOIN "CardReviewState" r ON r."flashcardId" = f.id AND r."userId" = ${userId}::uuid
      WHERE f.suspended = false AND d."studySetId" = ${studySetId}::uuid`,
  ]);
  const c = counts[0] ?? { total: 0n, due: 0n, unseen: 0n };
  const total = Number(c.total);
  const unseen = Number(c.unseen);
  return {
    decks: decks.map(
      (d): DeckView => ({ id: d.id, title: d.title, createdAt: d.createdAt.toISOString(), cards: d._count.cards, suspended: d.cards.length }),
    ),
    counts: { total, due: Number(c.due), newToday: Math.min(unseen, allowance), unseen, learned: total - unseen },
    activeJobs: jobs,
    readySources,
    aiConfigured: isAiConfigured(),
  };
}

export async function requestFlashcards(actor: Actor, set: StudySet, input: { count?: number; focus?: string }): Promise<{ jobId: string }> {
  if (!isAiConfigured()) throw badRequest("AI generation is not configured on this server yet.");
  await enforceRateLimit("generation", actor.id);
  const ready = await db.source.count({ where: { studySetId: set.id, status: "READY" } });
  if (!ready) throw badRequest("Add a source and wait for it to finish processing first.");
  const running = await db.generationJob.count({ where: { studySetId: set.id, type: "GENERATE_FLASHCARDS", status: { in: [...ACTIVE] } } });
  if (running) throw conflict("Flashcards are already being generated for this set.");
  const jobId = await createAndEnqueueJob({
    type: "GENERATE_FLASHCARDS",
    studySetId: set.id,
    userId: actor.id,
    stage: "GENERATING",
    payload: { count: input.count, focus: input.focus || undefined },
  });
  await audit({ userId: actor.id, action: "generation.request", entityType: "StudySet", entityId: set.id, metadata: { kind: "flashcards", ...input }, ip: actor.ip });
  return { jobId };
}

export async function listCards(userId: string, studySetId: string, deckId?: string): Promise<CardView[]> {
  const cards = await db.flashcard.findMany({
    where: { deck: { studySetId }, ...(deckId ? { deckId } : {}) },
    orderBy: [{ deck: { createdAt: "desc" } }, { createdAt: "asc" }],
    include: cardInclude(userId),
  });
  return cards.map(toView);
}

/**
 * Cards to review now: everything due (oldest first), then new cards up to
 * the daily limit, in the order they were written (which follows the course).
 */
export async function getReviewQueue(userId: string, studySetId: string): Promise<ReviewQueue> {
  const now = new Date();
  const allowance = await newAllowance(userId, studySetId);
  const [due, fresh] = await Promise.all([
    db.flashcard.findMany({
      where: { suspended: false, deck: { studySetId }, reviewStates: { some: { userId, due: { lte: now } } } },
      include: cardInclude(userId),
      take: QUEUE_LIMIT,
    }),
    allowance > 0
      ? db.flashcard.findMany({
          where: { suspended: false, deck: { studySetId }, reviewStates: { none: { userId } } },
          orderBy: [{ deck: { createdAt: "asc" } }, { createdAt: "asc" }],
          include: cardInclude(userId),
          take: allowance,
        })
      : Promise.resolve([] as CardRow[]),
  ]);
  due.sort((a, b) => a.reviewStates[0]!.due.getTime() - b.reviewStates[0]!.due.getTime());
  const cards = [...due, ...fresh].slice(0, QUEUE_LIMIT).map((c): QueueCard => {
    const options = scheduleAll(toSrs(c.reviewStates[0], now), now);
    const intervals = Object.fromEntries(RATINGS.map((r) => [r, formatInterval(options[r].due.getTime() - now.getTime())])) as Record<Rating, string>;
    return { ...toView(c), intervals };
  });
  return { cards, due: due.length, newToday: fresh.length };
}

/** Loads a card and checks access through its study set. */
export async function requireCard(userId: string, cardId: string, min: "VIEWER" | "EDITOR" = "VIEWER") {
  const card = await db.flashcard
    .findUnique({ where: { id: cardId }, include: { deck: { select: { studySetId: true } } } })
    .catch(() => null);
  if (!card) throw notFound("Flashcard");
  const set = await requireStudySet(userId, card.deck.studySetId, min);
  return { card, set };
}

export async function reviewCard(userId: string, cardId: string, rating: Rating, durationMs?: number): Promise<ReviewResult> {
  const now = new Date();
  const existing = await db.cardReviewState.findUnique({ where: { flashcardId_userId: { flashcardId: cardId, userId } } });
  const previous = toSrs(existing ?? undefined, now);
  const next = schedule(previous, rating, now);
  const data = {
    state: next.state,
    due: next.due,
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsedDays,
    scheduledDays: next.scheduledDays,
    reps: next.reps,
    lapses: next.lapses,
    lastReviewedAt: now,
  };
  await db.$transaction([
    db.cardReviewState.upsert({ where: { flashcardId_userId: { flashcardId: cardId, userId } }, create: { flashcardId: cardId, userId, ...data }, update: data }),
    db.attempt.create({
      data: {
        userId,
        kind: "FLASHCARD_REVIEW",
        flashcardId: cardId,
        rating,
        isCorrect: rating !== "AGAIN",
        durationMs,
        response: { previousState: previous.state, scheduledDays: next.scheduledDays },
      },
    }),
  ]);
  return { cardId, state: next.state, due: next.due.toISOString(), intervalLabel: formatInterval(next.due.getTime() - now.getTime()) };
}

export async function editCard(userId: string, cardId: string, input: { front?: string; back?: string; suspended?: boolean }): Promise<CardView> {
  const contentChanged = input.front !== undefined || input.back !== undefined;
  await db.flashcard.update({
    where: { id: cardId },
    data: {
      ...(input.front !== undefined ? { front: input.front } : {}),
      ...(input.back !== undefined ? { back: input.back } : {}),
      ...(input.suspended !== undefined ? { suspended: input.suspended } : {}),
      ...(contentChanged ? { editedByUser: true, version: { increment: 1 } } : {}),
    },
  });
  const card = await db.flashcard.findUniqueOrThrow({ where: { id: cardId }, include: cardInclude(userId) });
  return toView(card);
}

export async function deleteCard(cardId: string): Promise<void> {
  await db.flashcard.delete({ where: { id: cardId } });
}

export async function deleteDeck(userId: string, deckId: string): Promise<void> {
  const deck = await db.flashcardDeck.findUnique({ where: { id: deckId }, select: { studySetId: true } }).catch(() => null);
  if (!deck) throw notFound("Deck");
  await requireStudySet(userId, deck.studySetId, "EDITOR");
  await db.flashcardDeck.delete({ where: { id: deckId } });
}
