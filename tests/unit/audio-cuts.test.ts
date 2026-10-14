import { describe, expect, it } from "vitest";
import { parseSilences, planCuts } from "@/lib/audio-cuts";

const MIN = 60_000;

describe("parseSilences", () => {
  it("reads ffmpeg silencedetect output", () => {
    const out = [
      "[silencedetect @ 0x55] silence_start: 12.5",
      "[silencedetect @ 0x55] silence_end: 13.25 | silence_duration: 0.75",
      "frame= 1 fps=0",
      "[silencedetect @ 0x55] silence_start: -0.01",
      "[silencedetect @ 0x55] silence_end: 0.4 | silence_duration: 0.41",
    ].join("\n");
    expect(parseSilences(out)).toEqual([
      { startMs: 12_500, endMs: 13_250 },
      { startMs: 0, endMs: 400 },
    ]);
  });
});

describe("planCuts", () => {
  it("keeps short recordings in one piece", () => {
    expect(planCuts(5.5 * MIN, [], 5 * MIN)).toEqual([{ startMs: 0, endMs: 5.5 * MIN }]);
  });

  it("cuts inside the pause nearest each 5-minute mark", () => {
    const silences = [
      { startMs: 4 * MIN + 50_000, endMs: 4 * MIN + 51_000 }, // 10 s before the mark
      { startMs: 5 * MIN + 2_000, endMs: 5 * MIN + 3_000 }, // 2.5 s after: closest
      { startMs: 10 * MIN - 1_000, endMs: 10 * MIN + 1_000 },
    ];
    const spans = planCuts(14 * MIN, silences, 5 * MIN);
    // Second cut lands in the pause at 10:00 (2.5 s before the ideal 10:02.5).
    expect(spans.map((s) => s.startMs)).toEqual([0, 5 * MIN + 2_500, 10 * MIN]);
    expect(spans[1]!.endMs).toBe(spans[2]!.startMs);
    expect(spans.at(-1)!.endMs).toBe(14 * MIN);
  });

  it("falls back to the ideal point without pauses and never leaves a tiny tail", () => {
    const spans = planCuts(11 * MIN, [], 5 * MIN);
    expect(spans).toEqual([
      { startMs: 0, endMs: 5 * MIN },
      { startMs: 5 * MIN, endMs: 11 * MIN },
    ]);
  });

  it("covers the whole recording contiguously", () => {
    const silences = Array.from({ length: 200 }, (_, i) => ({ startMs: i * 17_000, endMs: i * 17_000 + 600 }));
    const spans = planCuts(90 * MIN, silences, 5 * MIN);
    expect(spans[0]!.startMs).toBe(0);
    expect(spans.at(-1)!.endMs).toBe(90 * MIN);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.startMs).toBe(spans[i - 1]!.endMs);
    for (const s of spans) expect(s.endMs - s.startMs).toBeLessThanOrEqual(5 * MIN + 45_000 + 1);
  });
});
