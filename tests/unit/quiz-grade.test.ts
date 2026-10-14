import { describe, expect, it } from "vitest";
import { grade, normalizeAnswer, parseNumber, seededShuffle } from "@/lib/quiz/grade";

describe("quiz grading", () => {
  it("grades single and multiple choice, with partial credit for multi-select", () => {
    expect(grade({ kind: "single", correct: "b" }, { kind: "single", choice: "b" })).toMatchObject({ isCorrect: true, score: 1 });
    expect(grade({ kind: "single", correct: "b" }, { kind: "single", choice: "a" })).toMatchObject({ isCorrect: false, score: 0 });
    const multi = { kind: "multi" as const, correct: ["a", "c"] };
    expect(grade(multi, { kind: "multi", choices: ["c", "a"] })).toMatchObject({ isCorrect: true, score: 1 });
    expect(grade(multi, { kind: "multi", choices: ["a"] })).toMatchObject({ isCorrect: false, score: 0.5 });
    expect(grade(multi, { kind: "multi", choices: ["a", "b"] })).toMatchObject({ isCorrect: false, score: 0 });
    expect(grade(multi, { kind: "multi", choices: ["a", "b", "c", "d"] }).score).toBe(0);
  });

  it("gives positional credit for ordering and per-pair credit for matching", () => {
    const order = { kind: "ordering" as const, order: ["1", "2", "3", "4"] };
    expect(grade(order, { kind: "ordering", order: ["1", "2", "3", "4"] }).isCorrect).toBe(true);
    expect(grade(order, { kind: "ordering", order: ["1", "2", "4", "3"] })).toMatchObject({ isCorrect: false, score: 0.5 });
    const match = { kind: "matching" as const, pairs: { l1: "r1", l2: "r2", l3: "r3" } };
    expect(grade(match, { kind: "matching", pairs: { l1: "r1", l2: "r3", l3: "r2" } })).toMatchObject({ isCorrect: false, score: 0.33 });
  });

  it("accepts numbers within tolerance, in common notations", () => {
    const num = { kind: "numerical" as const, value: 0.25, tolerance: 0.01, unit: "" };
    for (const v of ["0.25", "0,25", "2.5e-1", ".255", " 0.24 "]) expect(grade(num, { kind: "numerical", value: v }).isCorrect).toBe(true);
    expect(grade(num, { kind: "numerical", value: "0.3" }).isCorrect).toBe(false);
    expect(grade(num, { kind: "numerical", value: "abc" }).feedback).toMatch(/not a number/);
    const pct = { kind: "numerical" as const, value: 25, tolerance: 0.5, unit: "%" };
    expect(grade(pct, { kind: "numerical", value: "25" }).isCorrect).toBe(true);
    // Zero tolerance still tolerates rounding noise.
    expect(grade({ kind: "numerical", value: 1 / 3, tolerance: 0, unit: "" }, { kind: "numerical", value: "0.3333" }).isCorrect).toBe(true);
  });

  it("matches short answers loosely and defers the rest to judgement", () => {
    const text = { kind: "text" as const, acceptable: ["Chain rule", "la règle de dérivation en chaîne"], modelAnswer: "The chain rule", gradingNotes: "" };
    expect(grade(text, { kind: "text", text: "the CHAIN rule." })).toMatchObject({ isCorrect: true });
    expect(grade(text, { kind: "text", text: "La regle de derivation en chaine" }).isCorrect).toBe(true);
    expect(grade(text, { kind: "text", text: "differentiating composite functions" })).toMatchObject({ isCorrect: false, needsJudgement: true });
    expect(grade(text, { kind: "text", text: "   " }).needsJudgement).toBeUndefined();
  });

  it("parses numbers and normalizes answers", () => {
    expect(parseNumber("1 234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("−3")).toBe(-3);
    expect(parseNumber("25%")).toBe(0.25);
    expect(parseNumber("1e")).toBeNull();
    expect(normalizeAnswer("  The  Markov property! ")).toBe("markov property");
  });

  it("shuffles deterministically", () => {
    const items = ["a", "b", "c", "d", "e", "f"];
    expect(seededShuffle(items, "q1")).toEqual(seededShuffle(items, "q1"));
    expect([...seededShuffle(items, "q1")].sort()).toEqual(items);
    expect(seededShuffle(items, "q1")).not.toEqual(seededShuffle(items, "q2"));
  });
});
