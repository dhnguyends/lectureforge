/**
 * FSRS-5 spaced-repetition scheduler (Free Spaced Repetition Scheduler, the
 * algorithm Anki uses since 23.10). Pure functions, no I/O: the caller loads
 * and stores the card state (CardReviewState).
 *
 * Model: each card has a stability S (days until recall probability falls to
 * 90%) and a difficulty D (1–10). A review updates both from the rating and
 * from how much the card had been forgotten (retrievability R) at the time.
 * Simplification: no intra-day learning steps beyond one — a lapse or a first
 * "Again" brings the card back after 10 minutes; every other answer schedules
 * whole days.
 */

export const RATINGS = ["AGAIN", "HARD", "GOOD", "EASY"] as const;
export type Rating = (typeof RATINGS)[number];
export type SrsState = "NEW" | "LEARNING" | "REVIEW" | "RELEARNING";

export type SrsCard = {
  state: SrsState;
  due: Date;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  reps: number;
  lapses: number;
  lastReviewedAt: Date | null;
};

/** FSRS-5 default parameters (trained on ~700M reviews). */
const W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898,
  0.51655, 0.6621,
] as const;
const DECAY = -0.5;
const FACTOR = 19 / 81; // makes R(S, S) = 0.9
export const DESIRED_RETENTION = 0.9;
const MAX_INTERVAL_DAYS = 36_500;
export const RELEARN_MINUTES = 10;

const DAY_MS = 86_400_000;
const GRADE: Record<Rating, 1 | 2 | 3 | 4> = { AGAIN: 1, HARD: 2, GOOD: 3, EASY: 4 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const w = (i: number) => W[i]!;

export function newCard(now: Date): SrsCard {
  return { state: "NEW", due: now, stability: 0, difficulty: 0, elapsedDays: 0, scheduledDays: 0, reps: 0, lapses: 0, lastReviewedAt: null };
}

/** Probability of recall after `days` for a card of stability `stability`. */
export function retrievability(days: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * days) / stability, DECAY);
}

const initStability = (g: number) => Math.max(w(g - 1), 0.1);
const initDifficulty = (g: number) => clamp(w(4) - Math.exp(w(5) * (g - 1)) + 1, 1, 10);

function nextDifficulty(d: number, g: number): number {
  const delta = -w(6) * (g - 3);
  const damped = d + (delta * (10 - d)) / 9; // linear damping: changes shrink near 10
  return clamp(w(7) * initDifficulty(4) + (1 - w(7)) * damped, 1, 10); // mean reversion
}

function recallStability(d: number, s: number, r: number, g: number): number {
  const hardPenalty = g === 2 ? w(15) : 1;
  const easyBonus = g === 4 ? w(16) : 1;
  return s * (1 + Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp((1 - r) * w(10)) - 1) * hardPenalty * easyBonus);
}

function forgetStability(d: number, s: number, r: number): number {
  const sf = w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp((1 - r) * w(14));
  return Math.min(sf, s);
}

/** Same-day review (the card was already seen today). */
const shortTermStability = (s: number, g: number) => s * Math.exp(w(17) * (g - 3 + w(18)));

/** Days until recall probability falls to the desired retention. */
export function intervalDays(stability: number): number {
  const days = (stability / FACTOR) * (Math.pow(DESIRED_RETENTION, 1 / DECAY) - 1);
  return clamp(Math.round(days), 1, MAX_INTERVAL_DAYS);
}

/** The card's state after each possible answer, given now. */
export function scheduleAll(card: SrsCard, now: Date): Record<Rating, SrsCard> {
  const elapsed = card.lastReviewedAt ? Math.max(0, (now.getTime() - card.lastReviewedAt.getTime()) / DAY_MS) : 0;
  const fresh = card.state === "NEW" || card.stability <= 0;
  const sameDay = !fresh && elapsed < 1;
  const r = fresh ? 0 : retrievability(elapsed, card.stability);

  const memory = (g: number) => {
    if (fresh) return { s: initStability(g), d: initDifficulty(g) };
    const d = nextDifficulty(card.difficulty, g);
    if (sameDay) return { s: Math.max(0.1, shortTermStability(card.stability, g)), d };
    return { s: Math.max(0.1, g === 1 ? forgetStability(card.difficulty, card.stability, r) : recallStability(card.difficulty, card.stability, r, g)), d };
  };

  // Intervals must not invert: Hard ≤ Good < Easy.
  const m = { 2: memory(2), 3: memory(3), 4: memory(4) };
  let hard = intervalDays(m[2].s);
  let good = intervalDays(m[3].s);
  let easy = intervalDays(m[4].s);
  hard = Math.min(hard, good);
  good = Math.max(good, hard + (card.state === "REVIEW" ? 1 : 0));
  easy = Math.max(easy, good + 1);

  const base = { reps: card.reps + 1, lastReviewedAt: now, elapsedDays: Math.floor(elapsed) };
  const reviewed = (g: 2 | 3 | 4, days: number): SrsCard => ({
    ...card,
    ...base,
    state: "REVIEW",
    stability: m[g].s,
    difficulty: m[g].d,
    scheduledDays: days,
    due: new Date(now.getTime() + days * DAY_MS),
  });

  const again = memory(1);
  const lapse = card.state === "REVIEW";
  return {
    AGAIN: {
      ...card,
      ...base,
      state: lapse || card.state === "RELEARNING" ? "RELEARNING" : "LEARNING",
      lapses: card.lapses + (lapse ? 1 : 0),
      stability: again.s,
      difficulty: again.d,
      scheduledDays: 0,
      due: new Date(now.getTime() + RELEARN_MINUTES * 60_000),
    },
    HARD: reviewed(2, hard),
    GOOD: reviewed(3, good),
    EASY: reviewed(4, easy),
  };
}

export function schedule(card: SrsCard, rating: Rating, now: Date): SrsCard {
  return scheduleAll(card, now)[rating];
}

/** Short label for the time until a card is due: "10 min", "3 d", "2 mo", "1.4 y". */
export function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(ms / DAY_MS);
  if (days < 31) return `${days} d`;
  if (days < 365) return `${Math.round(days / 30.4)} mo`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} y`;
}
