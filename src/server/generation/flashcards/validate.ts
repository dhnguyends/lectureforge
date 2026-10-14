import type { CitationStrictness } from "@prisma/client";
import { normalizeForMatch, verifyExcerpt } from "@/lib/citations/verify";
import type { Passage, VerifiedCitation } from "../study-guide/validate";
import type { GeneratedCard } from "./schemas";

export type CardPolicy = { strictness: CitationStrictness; allowExternalKnowledge: boolean };

export type ValidatedCard = {
  type: GeneratedCard["type"];
  front: string;
  back: string;
  tags: string[];
  learningObjective: string | null;
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  confidence: number;
  warnings: string[];
  citations: VerifiedCitation[];
};

export type CardStats = { proposed: number; kept: number; dropped: number; duplicates: number; verified: number; failedCitations: number };

const CLOZE = /\{\{c\d+::([\s\S]+?)(?:::[^}]*)?\}\}/g;

/** Cloze cards use c1 only; any other index is folded into c1. */
function normalizeCloze(front: string): string {
  return front.replace(/\{\{c\d+::/g, "{{c1::");
}

/** Text used to spot duplicate cards: cloze answers revealed, case and punctuation folded. */
export function cardKey(front: string): string {
  // Punctuation becomes a space, so "two-state" and "two state" give the same words.
  return normalizeForMatch(front.replace(CLOZE, "$1"))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function similar(a: string, b: string): boolean {
  if (a === b) return true;
  const ta = new Set(a.split(" ").filter((w) => w.length > 2));
  const tb = new Set(b.split(" ").filter((w) => w.length > 2));
  if (ta.size < 3 || tb.size < 3) return false;
  let inter = 0;
  for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter) >= 0.85;
}

/**
 * Applies the grounding policy to generated cards, the same way as study
 * guide claims: a citation survives only if its passage was offered and the
 * excerpt is verbatim in it; unsupported "source" cards are dropped (STRICT)
 * or kept with a visible warning. Malformed and duplicate cards are removed.
 */
export function validateCards(cards: GeneratedCard[], passages: Passage[], policy: CardPolicy, existingKeys: string[] = []): { cards: ValidatedCard[]; stats: CardStats } {
  const byRef = new Map(passages.map((p) => [p.ref, p]));
  const stats: CardStats = { proposed: cards.length, kept: 0, dropped: 0, duplicates: 0, verified: 0, failedCitations: 0 };
  const keys = [...existingKeys];
  const out: ValidatedCard[] = [];

  for (const card of cards) {
    let type = card.type;
    let front = card.front.trim();
    const back = card.back.trim();
    if (type === "CLOZE") {
      front = normalizeCloze(front);
      if (!/\{\{c1::[\s\S]+?\}\}/.test(front)) type = back ? "BASIC" : type;
    }
    const malformed = type === "CLOZE" ? !/\{\{c1::[\s\S]+?\}\}/.test(front) : !back;
    if (malformed || front.length < 8) {
      stats.dropped++;
      continue;
    }

    const key = cardKey(front);
    if (keys.some((k) => similar(k, key))) {
      stats.duplicates++;
      continue;
    }

    const citations: VerifiedCitation[] = [];
    for (const c of card.citations) {
      const passage = byRef.get(c.ref);
      if (passage && verifyExcerpt(c.excerpt, passage.text)) citations.push({ ref: c.ref, chunkId: passage.chunkId, excerpt: c.excerpt.trim() });
      else stats.failedCitations++;
    }
    const verified = citations.length > 0;

    let claimType: ValidatedCard["claimType"] | null;
    const warnings: string[] = [];
    if (card.claimType === "external") {
      claimType = policy.allowExternalKnowledge ? "EXTERNAL" : null;
      if (claimType) warnings.push("Not stated in your sources.");
    } else if (!verified) {
      claimType = policy.strictness === "STRICT" ? null : "INFERENCE";
      if (claimType) warnings.push("No verified source excerpt — check this card against your materials.");
    } else {
      claimType = card.claimType === "inference" ? "INFERENCE" : "SOURCE_GROUNDED";
    }
    if (claimType === null) {
      stats.dropped++;
      continue;
    }

    keys.push(key);
    stats.kept++;
    if (verified) stats.verified++;
    out.push({
      type,
      front,
      back,
      tags: [...new Set(card.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))],
      learningObjective: card.learningObjective.trim() || null,
      claimType,
      confidence: Number(Math.max(0, Math.min(1, card.confidence * (verified ? 1 : 0.6))).toFixed(3)),
      warnings,
      citations,
    });
  }
  return { cards: out, stats };
}
