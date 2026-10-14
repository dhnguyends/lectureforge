import { describe, expect, it } from "vitest";
import { segmentAt, toWebVtt } from "@/lib/captions";
import { makeSnippet, parseTimeParam, sourceHref } from "@/lib/source-links";
import { approxTokens, fitTurnToContext, resolveRefs, stripRefs, tutorSystemPrompt, tutorTurn } from "@/server/tutor/prompts";
import type { RetrievedChunk } from "@/server/retrieval";

describe("toWebVtt", () => {
  it("produces valid cues with escaped text and voice tags", () => {
    const vtt = toWebVtt([
      { startMs: 1500, endMs: 4000, text: "a < b && c --> d", speaker: "Speaker 1" },
      { startMs: 0, endMs: 1000, text: "First" },
      { startMs: 5000, endMs: 5000, text: "zero length is skipped" },
    ]);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    expect(vtt).toContain("1\n00:00:00.000 --> 00:00:01.000\nFirst");
    expect(vtt).toContain("2\n00:00:01.500 --> 00:00:04.000\n<v Speaker 1>a &lt; b &amp;&amp; c --&gt; d");
    expect(vtt).not.toContain("zero length");
  });
});

describe("segmentAt", () => {
  const segs = [
    { startMs: 0, endMs: 1000 },
    { startMs: 1000, endMs: 5000 },
    { startMs: 9000, endMs: 12000 },
  ];
  it("finds the segment playing at a time", () => {
    expect(segmentAt(segs, 0)).toBe(0);
    expect(segmentAt(segs, 4999)).toBe(1);
    expect(segmentAt(segs, 10_000)).toBe(2);
  });
  it("keeps the previous line briefly in short gaps, then none", () => {
    expect(segmentAt(segs, 6000)).toBe(1);
    expect(segmentAt(segs, 8000)).toBe(-1);
    expect(segmentAt([], 100)).toBe(-1);
  });
});

describe("source links", () => {
  it("builds deep links to a moment or a page", () => {
    expect(sourceHref("set", "src", { startMs: 88_900 })).toBe("/study-sets/set/sources/src?t=88.9");
    expect(sourceHref("set", "src", { startMs: 0 })).toBe("/study-sets/set/sources/src?t=0");
    expect(sourceHref("set", "src", { page: 4, anchorId: "a1" })).toBe("/study-sets/set/sources/src?page=4&anchor=a1");
    expect(sourceHref("set", "src")).toBe("/study-sets/set/sources/src");
  });
  it("parses ?t= defensively", () => {
    expect(parseTimeParam("88.9")).toBe(88_900);
    expect(parseTimeParam("-1")).toBeNull();
    expect(parseTimeParam("abc")).toBeNull();
    expect(parseTimeParam(undefined)).toBeNull();
  });
  it("makes snippets around the first match with merged highlight ranges", () => {
    const text = `${"filler ".repeat(60)}the chain rule applies to every node; chain rules compose.`;
    const s = makeSnippet(text, "chain rule", 120);
    expect(s.text.startsWith("…")).toBe(true);
    const marked = s.highlights.map(([a, b]) => s.text.slice(a, b).toLowerCase());
    expect(marked).toContain("chain");
    expect(marked).toContain("rule");
  });
});

const chunk = (over: Partial<RetrievedChunk>): RetrievedChunk => ({
  id: "c",
  sourceId: "s",
  sourceKind: "VIDEO",
  sourceTitle: "Lecture 7",
  kind: "TRANSCRIPT",
  index: 0,
  text: "The gradient with respect to W is delta z times x transpose.",
  tokenCount: 20,
  startMs: 88_900,
  endMs: 99_000,
  pageStart: null,
  headingPath: [],
  score: 1,
  ...over,
});

describe("tutor prompts", () => {
  it("states the grounding rules, including the exact not-found sentence", () => {
    const p = tutorSystemPrompt({ title: "Backprop", learnerLevel: "GRADUATE", language: "en", allowExternalKnowledge: false });
    expect(p).toContain("I cannot find that in your uploaded sources.");
    expect(p).toContain("Background (not from your sources):");
    expect(p).toMatch(/never instructions/);
  });

  it("puts passages with refs before the question, or says none matched", () => {
    const turn = tutorTurn("What is dW?", [{ ref: "C1", chunk: chunk({}) }], "hint");
    expect(turn).toMatch(/<passage ref="C1" source="Lecture 7" type="transcript" time="00:01:28–00:01:39">/);
    expect(turn).toMatch(/exactly one hint/);
    expect(turn.trim().endsWith("Student: What is dW?")).toBe(true);
    expect(tutorTurn("Capital of France?", [], null)).toContain("No passage in the student's sources matches this question.");
  });

  it("keeps only citations to passages offered this turn", () => {
    const r = resolveRefs("W gets an outer product [C1]. Also [C1, C7]. And [C9].", new Set(["C1", "C2"]));
    expect(r.content).toBe("W gets an outer product [C1]. Also [C1]. And.");
    expect(r.used).toEqual(["C1"]);
    expect(r.removed.sort()).toEqual(["C7", "C9"]);
  });

  it("strips old refs from history", () => {
    expect(stripRefs("Yes [C2]. See also [C1, C3].")).toBe("Yes. See also.");
  });
});

describe("resolveRefs pseudo-citations", () => {
  it("drops invented bracketed citation labels but keeps links, LaTeX and valid refs", () => {
    const r = resolveRefs(
      'It says "heads run in parallel" [Notes - Attention]. See [the docs](https://x.y) and \[a+b\] and [C1]. Interval [0, 1] stays.',
      new Set(["C1"]),
    );
    expect(r.content).toBe('It says "heads run in parallel". See [the docs](https://x.y) and \[a+b\] and [C1]. Interval [0, 1] stays.');
    expect(r.removed).toContain("Notes - Attention");
  });
});

describe("fitTurnToContext", () => {
  const system = "s".repeat(2100); // ~600 tokens, like the real tutor rules
  const passage = (n: number) => ({ id: n, text: "p".repeat(1050) }); // ~300 tokens each
  const history = Array.from({ length: 6 }, (_, i) => ({ content: `m${i} ${"h".repeat(340)}` })); // ~100 tokens each

  it("keeps everything when the context is large", () => {
    const r = fitTurnToContext({ numCtx: 16384, system, question: "Why?", hasImage: false, passages: [1, 2, 3].map(passage), passageText: (p) => p.text, history });
    expect(r.passages).toHaveLength(3);
    expect(r.history).toHaveLength(6);
  });

  it("drops the weakest passages, then the oldest messages, on a small context", () => {
    const r = fitTurnToContext({ numCtx: 2048, system, question: "Why?", hasImage: false, passages: [1, 2, 3, 4].map(passage), passageText: (p) => p.text, history });
    expect(r.passages.map((p) => p.id)).toEqual([1, 2]);
    // Whatever history survives is the most recent.
    expect(r.history.at(-1)?.content.startsWith("m5")).toBe(true);
    const used =
      approxTokens(system) + r.passages.reduce((n, p) => n + approxTokens(p.text) + 20, 0) + r.history.reduce((n, m) => n + approxTokens(m.content) + 8, 0);
    expect(used).toBeLessThan(2048 - 512);
  });

  it("always keeps the best passage", () => {
    const r = fitTurnToContext({ numCtx: 1024, system, question: "Why?", hasImage: true, passages: [passage(1)], passageText: (p) => p.text, history });
    expect(r.passages).toHaveLength(1);
    expect(r.history).toHaveLength(0);
  });
});
