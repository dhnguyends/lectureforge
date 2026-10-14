import type { DetailLevel, FlashcardType, GenerationJob } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Usage } from "@/server/ai";
import { PipelineError } from "@/server/pipeline/errors";
import { loadAllChunks, retrieveChunks, type RetrievedChunk } from "@/server/retrieval";
import { buildAnchors } from "../anchors";
import type { GenerationContext, GenerationResult } from "../registry";
import { formatPassage } from "../study-guide/prompts";
import type { Passage } from "../study-guide/validate";
import { flashcardBatchPrompt, flashcardSystemPrompt, PROMPT_VERSION } from "./prompts";
import { CardBatchSchema, type GeneratedCard } from "./schemas";
import { cardKey, validateCards, type CardStats } from "./validate";

export type FlashcardsPayload = { count?: number; focus?: string };

/** Passages sent with one generation call. */
const BATCH_TOKENS = 12_000;
/** Source tokens per card when the user does not ask for a count. */
const TOKENS_PER_CARD: Record<DetailLevel, number> = { CONCISE: 450, STANDARD: 280, EXHAUSTIVE: 170 };
export const MAX_CARDS = 200;
const FOCUS_RETRIEVAL = 30;

type Batch = { passages: Passage[]; text: string; tokens: number };

/** Consecutive passages (reading order) grouped into calls of about BATCH_TOKENS. */
export function batchChunks(chunks: RetrievedChunk[], budget = BATCH_TOKENS): Batch[] {
  const batches: Batch[] = [];
  let current: { chunks: RetrievedChunk[]; tokens: number } = { chunks: [], tokens: 0 };
  const flush = () => {
    if (!current.chunks.length) return;
    const passages = current.chunks.map((c, i) => ({ ref: `C${i + 1}`, chunkId: c.id, text: c.text }));
    const text = current.chunks.map((c, i) => formatPassage(`C${i + 1}`, c)).join("\n\n");
    batches.push({ passages, text, tokens: current.tokens });
    current = { chunks: [], tokens: 0 };
  };
  for (const c of chunks) {
    if (current.tokens + c.tokenCount > budget && current.chunks.length) flush();
    current.chunks.push(c);
    current.tokens += c.tokenCount;
  }
  flush();
  return batches;
}

/** Cards to ask for: the user's count, or one per TOKENS_PER_CARD of material. */
export function targetCount(totalTokens: number, detail: DetailLevel, requested?: number): number {
  const auto = Math.round(totalTokens / TOKENS_PER_CARD[detail]);
  return Math.max(5, Math.min(MAX_CARDS, requested ?? auto));
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

/** GENERATE_FLASHCARDS: batch passages → cards → verify citations → dedupe → store a new deck. */
export async function generateFlashcards(job: GenerationJob, ctx: GenerationContext): Promise<GenerationResult> {
  const set = await db.studySet.findUniqueOrThrow({ where: { id: job.studySetId } });
  const payload = (job.payload as FlashcardsPayload | null) ?? {};
  const focus = payload.focus?.trim() || undefined;

  let chunks = await loadAllChunks(set.id);
  if (focus) {
    const relevant = new Set((await retrieveChunks(set.id, focus, FOCUS_RETRIEVAL)).map((c) => c.id));
    chunks = chunks.filter((c) => relevant.has(c.id)); // keep reading order
  }
  if (!chunks.length) throw new PipelineError(focus ? `Nothing in your sources matches “${focus}”.` : "There is no processed source material to make cards from yet.");

  const batches = batchChunks(chunks);
  const totalTokens = batches.reduce((n, b) => n + b.tokens, 0);
  const target = targetCount(totalTokens, set.detailLevel, payload.count);
  const system = flashcardSystemPrompt(set);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  // A retry of this job replaces the deck from the failed attempt.
  await db.flashcardDeck.deleteMany({ where: { generationJobId: job.id } });
  const deck = await db.flashcardDeck.create({
    data: { studySetId: set.id, title: (focus ? `${set.title} — ${focus}` : set.title).slice(0, 200), generationJobId: job.id },
  });

  await ctx.progress(0.03, `Writing about ${target} cards from ${batches.length} part${batches.length === 1 ? "" : "s"} of your materials`);
  let done = 0;
  const outputs = await pool(batches, env().GENERATION_CONCURRENCY, async (batch) => {
    const want = Math.max(2, Math.round((target * batch.tokens) / totalTokens));
    const res = await ctx.model.generateJson({ system, prompt: flashcardBatchPrompt(batch.text, want, focus), schema: CardBatchSchema, maxTokens: 16_000 });
    usage.inputTokens += res.usage.inputTokens;
    usage.outputTokens += res.usage.outputTokens;
    done++;
    await ctx.progress(0.05 + 0.75 * (done / batches.length), `Drafted cards for part ${done} of ${batches.length}`);
    return { cards: res.data.cards, warnings: res.data.warnings };
  });

  // Validate in reading order so duplicates are caught across batches and against earlier decks.
  const earlier = await db.flashcard.findMany({ where: { deck: { studySetId: set.id }, deckId: { not: deck.id } }, select: { front: true } });
  const keys = earlier.map((c) => cardKey(c.front));
  const stats: CardStats = { proposed: 0, kept: 0, dropped: 0, duplicates: 0, verified: 0, failedCitations: 0 };
  const policy = { strictness: set.citationStrictness, allowExternalKnowledge: set.allowExternalKnowledge && !set.sourcesOnly };
  let stored = 0;
  for (const [i, out] of outputs.entries()) {
    const room = MAX_CARDS - stored;
    if (room <= 0) break;
    const v = validateCards(out.cards.slice(0, room) as GeneratedCard[], batches[i]!.passages, policy, keys);
    for (const k of Object.keys(stats) as (keyof CardStats)[]) stats[k] += v.stats[k];
    for (const card of v.cards) {
      keys.push(cardKey(card.front));
      const row = await db.flashcard.create({
        data: {
          deckId: deck.id,
          type: card.type as FlashcardType,
          front: card.front,
          back: card.back,
          tags: card.tags,
          claimType: card.claimType,
          confidence: card.confidence,
          warnings: card.warnings,
          learningObjective: card.learningObjective,
        },
        select: { id: true },
      });
      const anchors = await buildAnchors(
        card.citations.map((citation) => ({ claimKey: "card", citation })),
        { flashcardId: row.id },
      );
      if (anchors.length) await db.citationAnchor.createMany({ data: anchors });
      stored++;
    }
    await ctx.progress(0.8 + 0.18 * ((i + 1) / outputs.length));
  }

  if (stored === 0) {
    await db.flashcardDeck.delete({ where: { id: deck.id } });
    throw new PipelineError("No flashcards could be matched to your sources. Try a different focus or a less strict citation setting.");
  }
  await ctx.log(
    stats.dropped || stats.failedCitations ? "WARN" : "INFO",
    `Kept ${stats.kept} of ${stats.proposed} cards: ${stats.verified} verified against sources, ${stats.dropped} removed, ${stats.duplicates} duplicates skipped`,
    stats,
  );
  await ctx.progress(1, `${stored} cards ready`);
  return {
    result: { deckId: deck.id, cards: stored, target, ...stats },
    usage,
    model: ctx.model.model,
    provider: ctx.model.provider,
    promptVersion: PROMPT_VERSION,
  };
}
