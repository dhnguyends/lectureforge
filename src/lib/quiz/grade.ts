/**
 * Quiz question shapes and deterministic grading. Pure: shared by the server
 * (authoritative grading) and tests. Answers live only on the server until
 * the learner has answered.
 */

export type Choice = { id: string; text: string };

export type QuestionOptions =
  | { kind: "choices"; choices: Choice[] } // MULTIPLE_CHOICE, MULTI_SELECT
  | { kind: "ordering"; items: Choice[] } // shown shuffled
  | { kind: "matching"; left: Choice[]; right: Choice[] } // right shown shuffled
  | { kind: "numerical"; unit: string }
  | { kind: "text" }; // SHORT_ANSWER

export type QuestionAnswer =
  | { kind: "single"; correct: string }
  | { kind: "multi"; correct: string[] }
  | { kind: "ordering"; order: string[] }
  | { kind: "matching"; pairs: Record<string, string> }
  | { kind: "numerical"; value: number; tolerance: number; unit: string }
  | { kind: "text"; acceptable: string[]; modelAnswer: string; gradingNotes: string };

export type QuestionResponse =
  | { kind: "single"; choice: string }
  | { kind: "multi"; choices: string[] }
  | { kind: "ordering"; order: string[] }
  | { kind: "matching"; pairs: Record<string, string> }
  | { kind: "numerical"; value: string }
  | { kind: "text"; text: string };

export type Grade = {
  isCorrect: boolean;
  /** 0..1; partial credit for multi-select, ordering and matching. */
  score: number;
  /** Set when the answer cannot be graded deterministically (free text). */
  needsJudgement?: boolean;
  feedback?: string;
};

/** Case-, accent-, punctuation- and space-insensitive form of a short answer. */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[“”«»"'`’]/g, "")
    .replace(/[^\p{L}\p{N}.,+\-*/^=<>()%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an|le|la|les|l|un|une|des|du) /, "")
    .replace(/[.,;:]+$/, "");
}

/** Parses "0.25", "0,25", "2.5e-1", "1 234,5", "25 %", "−3". */
export function parseNumber(raw: string): number | null {
  let s = raw.trim().replace(/−/g, "-").replace(/[\s  ]/g, "");
  let percent = false;
  if (s.endsWith("%")) {
    percent = true;
    s = s.slice(0, -1);
  }
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "").replace(",", "."); // 1.234,5
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, ""); // 1,234.5
  else s = s.replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return percent ? n / 100 : n;
}

function numericalMatch(given: number, value: number, tolerance: number): boolean {
  const tol = tolerance > 0 ? tolerance : Math.max(1e-9, Math.abs(value) * 1e-3);
  return Math.abs(given - value) <= tol + 1e-12;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function grade(answer: QuestionAnswer, response: QuestionResponse): Grade {
  switch (answer.kind) {
    case "single": {
      const ok = response.kind === "single" && response.choice === answer.correct;
      return { isCorrect: ok, score: ok ? 1 : 0 };
    }
    case "multi": {
      if (response.kind !== "multi") return { isCorrect: false, score: 0 };
      const want = new Set(answer.correct);
      const picked = new Set(response.choices);
      const hits = [...picked].filter((c) => want.has(c)).length;
      const wrong = picked.size - hits;
      const exact = hits === want.size && wrong === 0;
      return { isCorrect: exact, score: exact ? 1 : round2(Math.max(0, (hits - wrong) / want.size)) };
    }
    case "ordering": {
      if (response.kind !== "ordering") return { isCorrect: false, score: 0 };
      const inPlace = answer.order.filter((id, i) => response.order[i] === id).length;
      return { isCorrect: inPlace === answer.order.length, score: round2(inPlace / answer.order.length) };
    }
    case "matching": {
      if (response.kind !== "matching") return { isCorrect: false, score: 0 };
      const keys = Object.keys(answer.pairs);
      const right = keys.filter((k) => response.pairs[k] === answer.pairs[k]).length;
      return { isCorrect: right === keys.length, score: round2(right / keys.length) };
    }
    case "numerical": {
      if (response.kind !== "numerical") return { isCorrect: false, score: 0 };
      const n = parseNumber(response.value);
      if (n === null) return { isCorrect: false, score: 0, feedback: "That is not a number we could read." };
      // Accept a percentage written either as 25 or 0.25 when the unit is %.
      const ok = numericalMatch(n, answer.value, answer.tolerance) || (answer.unit.trim() === "%" && numericalMatch(n / 100, answer.value, answer.tolerance / 100));
      return { isCorrect: ok, score: ok ? 1 : 0 };
    }
    case "text": {
      if (response.kind !== "text" || !response.text.trim()) return { isCorrect: false, score: 0 };
      const given = normalizeAnswer(response.text);
      const ok = answer.acceptable.some((a) => normalizeAnswer(a) === given);
      return ok ? { isCorrect: true, score: 1 } : { isCorrect: false, score: 0, needsJudgement: true };
    }
  }
}

/** Fisher–Yates with a seeded PRNG, so a question's display order is stable. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
