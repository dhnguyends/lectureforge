import { describe, expect, it } from "vitest";
import { formatInterval, intervalDays, newCard, retrievability, schedule, scheduleAll, type SrsCard } from "@/lib/srs/fsrs";

const T0 = new Date("2026-10-14T08:00:00Z");
const DAY = 86_400_000;
const days = (c: SrsCard, from: Date) => Math.round((c.due.getTime() - from.getTime()) / DAY);

describe("FSRS-5 scheduler", () => {
  it("defines stability as the 90% recall point", () => {
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 6);
    expect(retrievability(0, 10)).toBe(1);
    expect(intervalDays(10)).toBe(10);
    expect(intervalDays(0.2)).toBe(1);
  });

  it("schedules a new card by its first answer", () => {
    const all = scheduleAll(newCard(T0), T0);
    expect(all.AGAIN.state).toBe("LEARNING");
    expect(all.AGAIN.due.getTime() - T0.getTime()).toBe(10 * 60_000);
    expect(days(all.HARD, T0)).toBe(1);
    expect(days(all.GOOD, T0)).toBe(3);
    expect(days(all.EASY, T0)).toBe(16);
    expect(all.GOOD.state).toBe("REVIEW");
    expect(all.GOOD.reps).toBe(1);
    // Harder first answers mean a more difficult card.
    expect(all.AGAIN.difficulty).toBeGreaterThan(all.GOOD.difficulty);
    expect(all.GOOD.difficulty).toBeGreaterThan(all.EASY.difficulty);
  });

  it("grows the interval with each successful review", () => {
    let card = schedule(newCard(T0), "GOOD", T0);
    const intervals: number[] = [];
    let now = T0;
    for (let i = 0; i < 5; i++) {
      now = card.due;
      const next = schedule(card, "GOOD", now);
      intervals.push(days(next, now));
      card = next;
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]!);
  });

  it("treats a forgotten review card as a lapse", () => {
    const learned = schedule(schedule(newCard(T0), "GOOD", T0), "GOOD", new Date(T0.getTime() + 3 * DAY));
    const now = learned.due;
    const lapsed = schedule(learned, "AGAIN", now);
    expect(lapsed.state).toBe("RELEARNING");
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.stability).toBeLessThan(learned.stability);
    expect(lapsed.due.getTime() - now.getTime()).toBe(10 * 60_000);
    // Recovered after relearning: back to review, but with a short interval.
    const back = schedule(lapsed, "GOOD", new Date(now.getTime() + 10 * 60_000));
    expect(back.state).toBe("REVIEW");
    expect(days(back, now)).toBeLessThan(days(learned, learned.lastReviewedAt!));
  });

  it("never inverts the answer buttons and keeps difficulty in range", () => {
    let card = schedule(newCard(T0), "EASY", T0);
    let now = T0;
    for (const r of ["HARD", "AGAIN", "GOOD", "EASY", "HARD", "HARD"] as const) {
      now = new Date(Math.max(card.due.getTime(), now.getTime() + 60_000));
      const all = scheduleAll(card, now);
      expect(days(all.HARD, now)).toBeLessThanOrEqual(days(all.GOOD, now));
      expect(days(all.GOOD, now)).toBeLessThan(days(all.EASY, now));
      card = all[r];
      expect(card.difficulty).toBeGreaterThanOrEqual(1);
      expect(card.difficulty).toBeLessThanOrEqual(10);
    }
  });

  it("formats intervals for the answer buttons", () => {
    expect(formatInterval(10 * 60_000)).toBe("10 min");
    expect(formatInterval(5 * 3600_000)).toBe("5 h");
    expect(formatInterval(3 * DAY)).toBe("3 d");
    expect(formatInterval(62 * DAY)).toBe("2 mo");
    expect(formatInterval(400 * DAY)).toBe("1.1 y");
  });
});
