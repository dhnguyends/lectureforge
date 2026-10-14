import { describe, expect, it } from "vitest";
import { clozeAnswer, clozeQuestion } from "@/components/flashcards/card-face";
import { batchChunks, MAX_CARDS, targetCount } from "@/server/generation/flashcards/generate";
import type { GeneratedCard } from "@/server/generation/flashcards/schemas";
import { cardKey, validateCards } from "@/server/generation/flashcards/validate";
import type { RetrievedChunk } from "@/server/retrieval";

const passages = [
  { ref: "C1", chunkId: "chunk-1", text: "A Markov chain is a sequence of random states where the next state depends only on the current state." },
  { ref: "C2", chunkId: "chunk-2", text: "The transition matrix P gives the probability of moving from state i to state j in one step." },
];

const card = (over: Partial<GeneratedCard> = {}): GeneratedCard => ({
  type: "BASIC",
  front: "What does the next state of a Markov chain depend on?",
  back: "Only on the current state.",
  tags: ["Markov"],
  learningObjective: "Define the Markov property",
  claimType: "source_grounded",
  citations: [{ ref: "C1", excerpt: "the next state depends only on the current state" }],
  confidence: 0.9,
  ...over,
});

describe("validateCards", () => {
  const policy = { strictness: "BALANCED" as const, allowExternalKnowledge: false };

  it("keeps a card whose excerpt is verbatim in its passage", () => {
    const { cards, stats } = validateCards([card()], passages, policy);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.claimType).toBe("SOURCE_GROUNDED");
    expect(cards[0]!.citations[0]!.chunkId).toBe("chunk-1");
    expect(cards[0]!.tags).toEqual(["markov"]);
    expect(stats.verified).toBe(1);
  });

  it("drops unsupported cards under STRICT and flags them otherwise", () => {
    const bad = card({ citations: [{ ref: "C2", excerpt: "the next state depends only on the current state" }] });
    expect(validateCards([bad], passages, { ...policy, strictness: "STRICT" }).cards).toHaveLength(0);
    const kept = validateCards([bad], passages, policy).cards[0]!;
    expect(kept.claimType).toBe("INFERENCE");
    expect(kept.warnings[0]).toMatch(/No verified source/);
    expect(kept.confidence).toBeLessThan(0.9);
  });

  it("removes external cards unless the set allows external knowledge", () => {
    const ext = card({ claimType: "external", citations: [] });
    expect(validateCards([ext], passages, policy).cards).toHaveLength(0);
    expect(validateCards([ext], passages, { ...policy, allowExternalKnowledge: true }).cards[0]!.claimType).toBe("EXTERNAL");
  });

  it("normalizes cloze markers and rejects malformed cards", () => {
    const cloze = card({ type: "CLOZE", front: "The {{c2::transition matrix}} P gives one-step probabilities.", back: "", citations: [{ ref: "C2", excerpt: "The transition matrix P gives the probability" }] });
    expect(validateCards([cloze], passages, policy).cards[0]!.front).toContain("{{c1::transition matrix}}");
    expect(validateCards([card({ type: "CLOZE", front: "No blank in this sentence at all.", back: "" })], passages, policy).cards).toHaveLength(0);
    expect(validateCards([card({ back: "" })], passages, policy).cards).toHaveLength(0);
  });

  it("skips duplicates within a batch and against existing cards", () => {
    const again = card({ front: "What does the next state of a Markov chain depend on ?" });
    expect(validateCards([card(), again], passages, policy).stats.duplicates).toBe(1);
    expect(validateCards([card()], passages, policy, [cardKey(card().front)]).cards).toHaveLength(0);
  });
});

describe("cloze rendering", () => {
  it("hides and reveals the cloze span", () => {
    const front = "The {{c1::transition matrix}} holds {{c1::probabilities::what kind of numbers}}.";
    expect(clozeQuestion(front)).toBe("The **[ … ]** holds **[… what kind of numbers …]**.");
    expect(clozeAnswer(front)).toBe("The **transition matrix** holds **probabilities**.");
  });
});

describe("batching and sizing", () => {
  const chunk = (i: number, tokens: number) => ({ id: `c${i}`, text: `text ${i}`, tokenCount: tokens, sourceTitle: "S", sourceKind: "PDF", kind: "PAGE_TEXT", startMs: null, endMs: null, pageStart: 1, headingPath: [] }) as unknown as RetrievedChunk;

  it("groups consecutive chunks under the token budget with local refs", () => {
    const batches = batchChunks([chunk(1, 6000), chunk(2, 5000), chunk(3, 4000), chunk(4, 20_000)], 12_000);
    expect(batches.map((b) => b.passages.map((p) => p.chunkId))).toEqual([["c1", "c2"], ["c3"], ["c4"]]);
    expect(batches[1]!.passages[0]!.ref).toBe("C1");
  });

  it("sizes the deck to the material unless a count is requested", () => {
    expect(targetCount(28_000, "STANDARD")).toBe(100);
    expect(targetCount(28_000, "CONCISE")).toBeLessThan(targetCount(28_000, "EXHAUSTIVE"));
    expect(targetCount(500, "STANDARD")).toBe(5);
    expect(targetCount(10_000_000, "STANDARD")).toBe(MAX_CARDS);
    expect(targetCount(28_000, "STANDARD", 20)).toBe(20);
  });
});

describe("review session navigation", () => {
  it("moves to the next unanswered card, wrapping round to skipped ones", async () => {
    const { nextUnanswered } = await import("@/components/flashcards/review-session");
    // Cards 0–4; 1 and 3 answered.
    const answers = [undefined, "GOOD", undefined, "EASY", undefined] as const;
    expect(nextUnanswered([...answers], 5, 0)).toBe(2);
    expect(nextUnanswered([...answers], 5, 2)).toBe(4);
    expect(nextUnanswered([...answers], 5, 4)).toBe(0); // skipped card at the start
    expect(nextUnanswered(["GOOD", "HARD"], 2, 0)).toBe(-1); // all answered
    // An "Again" card appended at the end is found.
    expect(nextUnanswered(["AGAIN", "GOOD"], 3, 1)).toBe(2);
  });
});
