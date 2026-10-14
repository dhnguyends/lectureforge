import type { CitationStrictness, QuestionType } from "@prisma/client";
import { verifyExcerpt } from "@/lib/citations/verify";
import { normalizeAnswer, seededShuffle, type Choice, type QuestionAnswer, type QuestionOptions } from "@/lib/quiz/grade";
import { cardKey, similar } from "../flashcards/validate";
import type { Passage, VerifiedCitation } from "../study-guide/validate";
import type { GeneratedQuestion } from "./schemas";

export type QuestionPolicy = { strictness: CitationStrictness; allowExternalKnowledge: boolean };

export type ValidatedQuestion = {
  type: QuestionType;
  prompt: string;
  options: QuestionOptions;
  answer: QuestionAnswer;
  explanation: string;
  /** Option id → the misconception that option represents. */
  distractorRationale: Record<string, string> | null;
  learningObjective: string;
  topic: string | null;
  difficulty: number;
  claimType: "SOURCE_GROUNDED" | "INFERENCE" | "EXTERNAL";
  confidence: number;
  warnings: string[];
  citations: VerifiedCitation[];
};

export type QuestionStats = { proposed: number; kept: number; dropped: number; malformed: number; duplicates: number; verified: number; failedCitations: number };

const LETTERS = ["a", "b", "c", "d", "e", "f"];
const unique = (texts: string[]) => new Set(texts.map(normalizeAnswer)).size === texts.length;

/** Shuffles a permutation so it never equals the original order (for ordering/matching). */
function shuffledNotIdentity<T>(items: T[], seed: string): T[] {
  const s = seededShuffle(items, seed);
  return s.every((x, i) => x === items[i]) ? [...items.slice(1), items[0]!] : s;
}

const MAX_TEXT = 2000;
const clean = (s: string, max = 500) => s.trim().slice(0, max);

/** Turns a generated question into stored options + answer, or null if it is malformed. */
function shape(q: GeneratedQuestion): Pick<ValidatedQuestion, "options" | "answer" | "distractorRationale"> | null {
  const seed = q.prompt;
  switch (q.type) {
    case "MULTIPLE_CHOICE":
    case "MULTI_SELECT": {
      const options = q.options.map((o) => ({ id: o.id.trim().toLowerCase(), text: clean(o.text) })).filter((o) => o.text);
      const [min, max] = q.type === "MULTIPLE_CHOICE" ? [3, 6] : [4, 6];
      if (options.length < min || options.length > max) return null;
      const ids = options.map((o) => o.id);
      if (new Set(ids).size !== ids.length || !unique(options.map((o) => o.text))) return null;
      const correct = [...new Set(q.correct.map((c) => c.trim().toLowerCase()))];
      if (q.type === "MULTIPLE_CHOICE" && correct.length !== 1) return null;
      if (!correct.length || !correct.every((c) => ids.includes(c))) return null;
      if (q.type === "MULTI_SELECT" && correct.length === ids.length) return null;
      q = { ...q, options, distractors: q.distractors.map((d) => ({ id: d.id.trim().toLowerCase(), why: clean(d.why, 400) })) };
      // Shuffle and relabel so the correct answer's position carries no signal.
      const shuffled = seededShuffle(q.options, seed);
      const relabel = new Map(shuffled.map((o, i) => [o.id, LETTERS[i]!]));
      const choices: Choice[] = shuffled.map((o, i) => ({ id: LETTERS[i]!, text: o.text.trim() }));
      const rationale = Object.fromEntries(q.distractors.filter((d) => relabel.has(d.id) && !correct.includes(d.id) && d.why.trim()).map((d) => [relabel.get(d.id)!, d.why.trim()]));
      const mapped = correct.map((c) => relabel.get(c)!).sort();
      return {
        options: { kind: "choices", choices },
        answer: q.type === "MULTIPLE_CHOICE" ? { kind: "single", correct: mapped[0]! } : { kind: "multi", correct: mapped },
        distractorRationale: Object.keys(rationale).length ? rationale : null,
      };
    }
    case "SHORT_ANSWER": {
      const acceptable = [...new Set(q.acceptableAnswers.map((a) => clean(a, 200)).filter(Boolean))].slice(0, 8);
      if (!acceptable.length || !q.modelAnswer.trim()) return null;
      return {
        options: { kind: "text" },
        answer: { kind: "text", acceptable, modelAnswer: clean(q.modelAnswer, 1000), gradingNotes: clean(q.gradingNotes) },
        distractorRationale: null,
      };
    }
    case "NUMERICAL": {
      if (q.value === null || !Number.isFinite(q.value)) return null;
      const given = q.tolerance !== null && Number.isFinite(q.tolerance) ? Math.abs(q.tolerance) : 0;
      // A tolerance wider than a fifth of the value would accept nearly anything.
      const tolerance = q.value !== 0 && given > Math.abs(q.value) * 0.2 ? Math.abs(q.value) * 0.05 : given;
      const unit = clean(q.unit, 30);
      return { options: { kind: "numerical", unit }, answer: { kind: "numerical", value: q.value, tolerance, unit }, distractorRationale: null };
    }
    case "ORDERING": {
      const texts = q.itemsInOrder.map((t) => clean(t, 300)).filter(Boolean);
      if (texts.length < 3 || texts.length > 7 || !unique(texts)) return null;
      const items = texts.map((text, i) => ({ id: String(i + 1), text }));
      return { options: { kind: "ordering", items: shuffledNotIdentity(items, seed) }, answer: { kind: "ordering", order: items.map((i) => i.id) }, distractorRationale: null };
    }
    case "MATCHING": {
      const pairs = q.pairs.map((p) => ({ left: clean(p.left, 200), right: clean(p.right, 300) })).filter((p) => p.left && p.right);
      if (pairs.length < 3 || pairs.length > 6 || !unique(pairs.map((p) => p.left)) || !unique(pairs.map((p) => p.right))) return null;
      const left = pairs.map((p, i) => ({ id: `l${i + 1}`, text: p.left }));
      const right = pairs.map((p, i) => ({ id: `r${i + 1}`, text: p.right }));
      return {
        options: { kind: "matching", left, right: shuffledNotIdentity(right, seed) },
        answer: { kind: "matching", pairs: Object.fromEntries(left.map((l, i) => [l.id, right[i]!.id])) },
        distractorRationale: null,
      };
    }
  }
}

/**
 * Applies the grounding policy (as for study guides and flashcards) and
 * structural checks, removes near-duplicate prompts, and converts each
 * question to its stored form.
 */
export function validateQuestions(questions: GeneratedQuestion[], passages: Passage[], policy: QuestionPolicy, existingKeys: string[] = []): { questions: ValidatedQuestion[]; stats: QuestionStats } {
  const byRef = new Map(passages.map((p) => [p.ref, p]));
  const stats: QuestionStats = { proposed: questions.length, kept: 0, dropped: 0, malformed: 0, duplicates: 0, verified: 0, failedCitations: 0 };
  const keys = [...existingKeys];
  const out: ValidatedQuestion[] = [];

  for (const q of questions) {
    const shaped = q.prompt.trim().length >= 5 && q.explanation.trim() ? shape(q) : null;
    if (!shaped) {
      stats.malformed++;
      continue;
    }
    const key = cardKey(q.prompt);
    if (keys.some((k) => similar(k, key))) {
      stats.duplicates++;
      continue;
    }

    const citations: VerifiedCitation[] = [];
    for (const c of q.citations.slice(0, 3)) {
      const passage = byRef.get(c.ref);
      if (passage && verifyExcerpt(c.excerpt, passage.text)) citations.push({ ref: c.ref, chunkId: passage.chunkId, excerpt: c.excerpt.trim() });
      else stats.failedCitations++;
    }
    const verified = citations.length > 0;
    const warnings: string[] = [];
    let claimType: ValidatedQuestion["claimType"] | null;
    if (q.claimType === "external") {
      claimType = policy.allowExternalKnowledge ? "EXTERNAL" : null;
      if (claimType) warnings.push("Needs knowledge that is not in your sources.");
    } else if (!verified) {
      claimType = policy.strictness === "STRICT" ? null : "INFERENCE";
      if (claimType) warnings.push("No verified source excerpt — check this question against your materials.");
    } else {
      claimType = q.claimType === "inference" ? "INFERENCE" : "SOURCE_GROUNDED";
    }
    if (claimType === null) {
      stats.dropped++;
      continue;
    }

    keys.push(key);
    stats.kept++;
    if (verified) stats.verified++;
    out.push({
      type: q.type,
      prompt: clean(q.prompt, MAX_TEXT),
      ...shaped,
      explanation: clean(q.explanation, 3000),
      learningObjective: clean(q.learningObjective, 300),
      topic: clean(q.topic, 80) || null,
      difficulty: Math.min(5, Math.max(1, Math.round(q.difficulty) || 2)),
      claimType,
      confidence: Number(Math.max(0, Math.min(1, q.confidence * (verified ? 1 : 0.6))).toFixed(3)),
      warnings,
      citations,
    });
  }
  return { questions: out, stats };
}
