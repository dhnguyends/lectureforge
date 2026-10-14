import { describe, expect, it } from "vitest";
import { grade } from "@/lib/quiz/grade";
import { quizBatchBudget, trimQuestions } from "@/server/generation/quiz/generate";
import { QuestionSchema, type GeneratedQuestion } from "@/server/generation/quiz/schemas";
import { validateQuestions } from "@/server/generation/quiz/validate";

const passages = [
  { ref: "C1", chunkId: "chunk-1", text: "A Markov chain is a sequence of random states where the next state depends only on the current state." },
  { ref: "C2", chunkId: "chunk-2", text: "Each row of the transition matrix P sums to one, and P squared gives the two-step transition probabilities." },
];
const policy = { strictness: "BALANCED" as const, allowExternalKnowledge: false };

/** Every field present, unused ones empty — the shape the model returns. */
const blank: GeneratedQuestion = {
  type: "MULTIPLE_CHOICE",
  prompt: "",
  options: [],
  correct: [],
  distractors: [],
  acceptableAnswers: [],
  modelAnswer: "",
  gradingNotes: "",
  value: null,
  tolerance: null,
  unit: "",
  itemsInOrder: [],
  pairs: [],
  explanation: "Because of the Markov property.",
  learningObjective: "State the Markov property",
  topic: "Markov property",
  difficulty: 2,
  claimType: "source_grounded",
  citations: [{ ref: "C1", excerpt: "the next state depends only on the current state" }],
  confidence: 0.9,
};

const mc = (over: Partial<GeneratedQuestion> = {}): GeneratedQuestion => ({
  ...blank,
  prompt: "In a Markov chain, what does the next state depend on?",
  options: [
    { id: "a", text: "The whole history of states" },
    { id: "b", text: "Only the current state" },
    { id: "c", text: "The initial state only" },
    { id: "d", text: "Nothing: states are independent" },
  ],
  correct: ["b"],
  distractors: [
    { id: "a", why: "Confuses Markov chains with general processes." },
    { id: "c", why: "Mixes up the initial distribution with the dynamics." },
  ],
  ...over,
});

describe("validateQuestions", () => {
  it("shuffles and relabels choices, keeping the answer and rationales consistent", () => {
    const { questions } = validateQuestions([mc()], passages, policy);
    const q = questions[0]!;
    if (q.options.kind !== "choices" || q.answer.kind !== "single") throw new Error("shape");
    expect(q.options.choices.map((c) => c.id)).toEqual(["a", "b", "c", "d"]);
    const correct = q.answer.correct;
    expect(q.options.choices.find((c) => c.id === correct)!.text).toBe("Only the current state");
    const historyId = q.options.choices.find((c) => c.text.startsWith("The whole history"))!.id;
    expect(q.distractorRationale?.[historyId]).toMatch(/general processes/);
    expect(grade(q.answer, { kind: "single", choice: correct }).isCorrect).toBe(true);
  });

  it("removes malformed questions", () => {
    const bad: GeneratedQuestion[] = [
      mc({ correct: ["z"] }),
      mc({ correct: ["a", "b"] }), // two answers for single choice
      mc({ options: [{ id: "a", text: "Same" }, { id: "b", text: "same" }, { id: "c", text: "Other" }], correct: ["a"] }),
      { ...blank, type: "ORDERING", prompt: "Order these steps of the algorithm", itemsInOrder: ["one", "two", "One"] },
      { ...mc(), type: "MULTI_SELECT", prompt: "Select all that apply: which are true?", correct: ["a", "b", "c", "d"] },
      { ...blank, type: "NUMERICAL", prompt: "Compute the probability of state 2", value: null },
      { ...blank, type: "SHORT_ANSWER", prompt: "Name the rule used here", acceptableAnswers: [], modelAnswer: "x" },
      mc({ prompt: "Why?" }),
      mc({ explanation: "  " }),
    ];
    const { questions, stats } = validateQuestions(bad, passages, policy);
    expect(questions).toHaveLength(0);
    expect(stats.malformed).toBe(bad.length);
  });

  it("stores ordering and matching shuffled, never in the answer's order", () => {
    const ordering: GeneratedQuestion = { ...blank, type: "ORDERING", prompt: "Put the steps in order", itemsInOrder: ["Define states", "Estimate P", "Square P"] };
    const matching: GeneratedQuestion = {
      ...blank,
      type: "MATCHING",
      prompt: "Match each term with its meaning",
      pairs: [
        { left: "P", right: "transition matrix" },
        { left: "π", right: "stationary distribution" },
        { left: "n", right: "number of steps" },
      ],
    };
    const { questions } = validateQuestions([ordering, matching], passages, policy);
    const [o, m] = questions;
    if (o!.options.kind !== "ordering" || o!.answer.kind !== "ordering") throw new Error("shape");
    expect(o!.options.items.map((i) => i.id)).not.toEqual(o!.answer.order);
    expect(grade(o!.answer, { kind: "ordering", order: o!.answer.order }).isCorrect).toBe(true);
    if (m!.options.kind !== "matching" || m!.answer.kind !== "matching") throw new Error("shape");
    expect(m!.options.right.map((r) => r.id)).not.toEqual(["r1", "r2", "r3"]);
    expect(m!.answer.pairs).toEqual({ l1: "r1", l2: "r2", l3: "r3" });
  });

  it("applies the grounding policy, clamps ranges and tames an absurd numeric tolerance", () => {
    const num: GeneratedQuestion = {
      ...blank,
      type: "NUMERICAL",
      prompt: "What does each row of P sum to?",
      value: 1,
      tolerance: 5,
      difficulty: 9,
      citations: [{ ref: "C2", excerpt: "Each row of the transition matrix P sums to one" }],
    };
    const q = validateQuestions([num], passages, policy).questions[0]!;
    expect(q.answer).toMatchObject({ kind: "numerical", value: 1, tolerance: 0.05 });
    expect(q.difficulty).toBe(5);
    expect(q.claimType).toBe("SOURCE_GROUNDED");
    const unsupported = mc({ citations: [{ ref: "C2", excerpt: "made up words that are not there" }] });
    expect(validateQuestions([unsupported], passages, { ...policy, strictness: "STRICT" }).questions).toHaveLength(0);
    expect(validateQuestions([unsupported], passages, policy).questions[0]!.warnings[0]).toMatch(/No verified/);
    expect(validateQuestions([mc({ claimType: "external", citations: [] })], passages, policy).questions).toHaveLength(0);
  });

  it("skips near-duplicate prompts", () => {
    const again = mc({ prompt: "In a Markov chain, what does the next state depend on ?" });
    expect(validateQuestions([mc(), again], passages, policy).stats.duplicates).toBe(1);
  });

  it("parses the model's flat shape", () => {
    expect(QuestionSchema.safeParse(mc()).success).toBe(true);
    expect(QuestionSchema.safeParse({ ...mc(), value: undefined }).success).toBe(false);
  });
});

describe("sizing", () => {
  it("keeps the most confident questions in course order", () => {
    const qs = [0.9, 0.5, 0.95, 0.7, 0.8].map((confidence, i) => ({ i, confidence }));
    expect(trimQuestions(qs, 3).map((q) => q.i)).toEqual([0, 2, 4]);
    expect(trimQuestions(qs, 10)).toHaveLength(5);
  });

  it("sizes batches so each call writes about four questions", () => {
    expect(quizBatchBudget(100_000, 10)).toBe(33_334); // 3 calls
    expect(quizBatchBudget(5_000, 10)).toBe(10_000);
    expect(quizBatchBudget(1_000_000, 5)).toBe(40_000);
  });
});
