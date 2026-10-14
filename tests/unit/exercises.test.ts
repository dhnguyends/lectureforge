import { describe, expect, it } from "vitest";
import { countsFrom, DEFAULT_COUNTS, selectPassages } from "@/server/generation/exercises/generate";
import { exerciseTypesFor } from "@/server/generation/exercises/prompts";
import { ExerciseBatchSchema, type GeneratedExercise } from "@/server/generation/exercises/schemas";
import { answersAgree, effectiveTolerance, tierOf, validateExercises } from "@/server/generation/exercises/validate";
import type { RetrievedChunk } from "@/server/retrieval";

const passages = [
  { ref: "C1", chunkId: "chunk-1", text: "The stationary distribution pi satisfies pi P = pi and its entries sum to one." },
  { ref: "C2", chunkId: "chunk-2", text: "Net present value discounts each future cash flow at the cost of capital and sums them." },
];
const policy = { strictness: "BALANCED" as const, allowExternalKnowledge: false };

const ex = (over: Partial<GeneratedExercise> = {}): GeneratedExercise => ({
  type: "QUANTITATIVE",
  grounding: "source_grounded",
  title: "Stationary distribution of a two-state chain",
  statement: "A chain has transition matrix $P = \\begin{pmatrix} 0.9 & 0.1 \\\\ 0.5 & 0.5 \\end{pmatrix}$. Find $\\pi_1$.",
  learningObjective: "Compute a stationary distribution",
  prerequisites: ["Transition matrices"],
  assumptions: ["The chain is irreducible"],
  expectedFormat: "A short calculation ending with pi_1 to 3 decimals.",
  estimatedMinutes: 10,
  difficulty: 2,
  hints: ["Write pi P = pi as equations.", "Use pi_1 + pi_2 = 1."],
  solution: "From $\\pi_1 = 0.9\\pi_1 + 0.5\\pi_2$ we get $0.1\\pi_1 = 0.5\\pi_2$, so $\\pi_1 = 5/6 \\approx 0.833$.",
  rubric: ["Sets up pi P = pi", "Uses normalisation", "Gets pi_1 = 0.833"],
  finalAnswer: { value: 0.8333, tolerance: 0.001, unit: "" },
  claimType: "source_grounded",
  citations: [{ ref: "C1", excerpt: "The stationary distribution pi satisfies pi P = pi" }],
  confidence: 0.9,
  ...over,
});

describe("validateExercises", () => {
  it("keeps a well-formed exercise inside its tier's ranges", () => {
    const { exercises, stats } = validateExercises([ex({ difficulty: 4, estimatedMinutes: 200 })], "easy", passages, policy);
    expect(exercises).toHaveLength(1);
    const e = exercises[0]!;
    expect(e.difficulty).toBe(2); // clamped into easy (1–2)
    expect(e.estimatedMinutes).toBe(30); // at most twice the tier's upper bound
    expect(e.claimType).toBe("SOURCE_GROUNDED");
    expect(e.finalAnswer).toEqual({ value: 0.8333, tolerance: 0.001, unit: "" });
    expect(stats.verified).toBe(1);
  });

  it("removes malformed exercises", () => {
    const bad = [ex({ hints: [] }), ex({ rubric: ["only one"] }), ex({ solution: "short" }), ex({ statement: "Too short" })];
    const { exercises, stats } = validateExercises(bad, "intermediate", passages, policy);
    expect(exercises).toHaveLength(0);
    expect(stats.malformed).toBe(4);
  });

  it("applies the grounding policy and flags calculations without a final number", () => {
    const unsupported = ex({ citations: [{ ref: "C2", excerpt: "words that are not in the passage" }] });
    expect(validateExercises([unsupported], "easy", passages, { ...policy, strictness: "STRICT" }).exercises).toHaveLength(0);
    expect(validateExercises([unsupported], "easy", passages, policy).exercises[0]!.claimType).toBe("INFERENCE");
    expect(validateExercises([ex({ claimType: "external", citations: [] })], "easy", passages, policy).exercises).toHaveLength(0);
    const noNumber = validateExercises([ex({ finalAnswer: { value: null, tolerance: null, unit: "" } })], "easy", passages, policy).exercises[0]!;
    expect(noNumber.finalAnswer).toBeNull();
    expect(noNumber.warnings.join(" ")).toMatch(/No single final number/);
  });

  it("marks transfer exercises and skips duplicates", () => {
    const t = validateExercises([ex({ grounding: "transfer" })], "difficult", passages, policy).exercises[0]!;
    expect(t.grounding).toBe("TRANSFER");
    expect(t.difficulty).toBe(4);
    const r = validateExercises([ex(), ex({ title: "Stationary distribution of a two state chain" })], "easy", passages, policy);
    expect(r.stats.duplicates).toBe(1);
  });

  it("parses the model's flat shape", () => {
    expect(ExerciseBatchSchema.safeParse({ exercises: [ex()], warnings: [] }).success).toBe(true);
  });
});

describe("numeric checks", () => {
  it("compares answers within the tolerance (at least 1%)", () => {
    const fa = { value: 0.8333, tolerance: 0.001, unit: "" };
    expect(answersAgree(fa, 5 / 6)).toBe(true);
    expect(answersAgree(fa, 0.84)).toBe(true); // within 1%
    expect(answersAgree(fa, 0.9)).toBe(false);
    expect(effectiveTolerance(200, null)).toBe(2);
    expect(effectiveTolerance(0, 0)).toBeGreaterThan(0);
  });
});

describe("set composition", () => {
  it("defaults to 5 easy, 5 intermediate and 2 difficult", () => {
    expect(DEFAULT_COUNTS).toEqual({ easy: 5, intermediate: 5, difficult: 2 });
    expect(countsFrom({})).toEqual({ easy: 5, intermediate: 5, difficult: 2 });
    expect(countsFrom({ easy: 0, intermediate: 3, difficult: 50 })).toEqual({ easy: 0, intermediate: 3, difficult: 10 });
  });

  it("maps difficulty to tiers and profiles to exercise types", () => {
    expect([1, 2, 3, 4, 5].map(tierOf)).toEqual(["easy", "easy", "intermediate", "difficult", "difficult"]);
    expect(exerciseTypesFor("business_school")).toContain("CASE_ANALYSIS");
    expect(exerciseTypesFor("business_school")).not.toContain("CODE_DEBUGGING");
    expect(exerciseTypesFor("engineering")).toContain("DERIVATION");
    expect(exerciseTypesFor("engineering")).not.toContain("CASE_ANALYSIS");
    expect(exerciseTypesFor("research")).toContain("PAPER_CRITIQUE");
  });

  it("samples long material evenly within the budget, in reading order", () => {
    const chunks = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, tokenCount: 1000 }) as unknown as RetrievedChunk);
    const picked = selectPassages(chunks, 40_000);
    expect(picked.reduce((n, c) => n + c.tokenCount, 0)).toBeLessThanOrEqual(40_000);
    expect(picked[0]!.id).toBe("c0");
    expect(picked.at(-1)!.id).not.toBe("c39"); // spread across, not just the beginning
    expect(selectPassages(chunks.slice(0, 10), 40_000)).toHaveLength(10);
  });
});
