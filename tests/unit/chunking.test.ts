import { describe, expect, it } from "vitest";
import { chunkDocument, headingLevel, isEquationLine, stripRunningHeadersFooters, textToPage, toBlocks } from "@/lib/chunking/document";
import { chunkTranscript, type TranscriptSegmentInput } from "@/lib/chunking/transcript";
import { mergeTranscriptParts } from "@/lib/transcript";

function segments(n: number, opts: { words?: number; gapMs?: number; speakerEvery?: number } = {}): TranscriptSegmentInput[] {
  const words = opts.words ?? 25;
  let t = 0;
  return Array.from({ length: n }, (_, i) => {
    const start = t;
    const end = start + 8000;
    t = end + (opts.gapMs ?? 200);
    return {
      index: i,
      startMs: start,
      endMs: end,
      speaker: opts.speakerEvery ? `Speaker ${Math.floor(i / opts.speakerEvery) % 2 + 1}` : null,
      text: `${Array.from({ length: words }, (_, w) => `word${i}_${w}`).join(" ")}.`,
    };
  });
}

describe("chunkTranscript", () => {
  it("covers every segment, in order, with exact time bounds", () => {
    const segs = segments(60);
    const chunks = chunkTranscript(segs);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]!.firstSegment).toBe(0);
    expect(chunks.at(-1)!.lastSegment).toBe(59);
    for (const c of chunks) {
      expect(c.startMs).toBe(segs[c.firstSegment]!.startMs);
      expect(c.endMs).toBe(segs[c.lastSegment]!.endMs);
    }
    // No gaps: each chunk starts at or before the previous one ended (+1 for overlap).
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.firstSegment).toBeLessThanOrEqual(chunks[i - 1]!.lastSegment + 1);
      expect(chunks[i]!.lastSegment).toBeGreaterThan(chunks[i - 1]!.lastSegment);
    }
  });

  it("respects the maximum chunk size", () => {
    const chunks = chunkTranscript(segments(80, { words: 40 }), { targetTokens: 200, maxTokens: 400 });
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(400 + 120);
  });

  it("never emits a chunk made only of overlap", () => {
    const chunks = chunkTranscript(segments(30, { words: 60 }), { targetTokens: 100, maxTokens: 200, overlapSegments: 1 });
    const keys = chunks.map((c) => `${c.firstSegment}-${c.lastSegment}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.lastSegment).toBeGreaterThan(chunks[i - 1]!.lastSegment);
  });

  it("labels speakers when there are several", () => {
    const chunks = chunkTranscript(segments(6, { speakerEvery: 3 }));
    expect(chunks[0]!.text).toContain("[Speaker 1]");
    expect(chunks.flatMap((c) => c.speakers)).toContain("Speaker 2");
  });

  it("returns nothing for empty input", () => {
    expect(chunkTranscript([])).toEqual([]);
  });
});

describe("mergeTranscriptParts", () => {
  it("offsets parts, drops empties and boundary duplicates, and re-indexes", () => {
    const merged = mergeTranscriptParts([
      { startMs: 0, segments: [{ startMs: 0, endMs: 4000, text: " Hello  world ", speaker: null, confidence: 0.9 }, { startMs: 4000, endMs: 4000, text: "", speaker: null, confidence: null }] },
      { startMs: 600_000, segments: [{ startMs: 0, endMs: 3000, text: "Second part", speaker: null, confidence: null }] },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ index: 0, text: "Hello world", startMs: 0, endMs: 4000 });
    expect(merged[1]).toMatchObject({ index: 1, startMs: 600_000, endMs: 603_000 });
  });

  it("clamps to the media duration", () => {
    const merged = mergeTranscriptParts([{ startMs: 0, segments: [{ startMs: 1000, endMs: 99_000, text: "tail", speaker: null, confidence: null }] }], 5000);
    expect(merged[0]!.endMs).toBe(5000);
  });
});

describe("document structure detection", () => {
  it("recognises headings", () => {
    expect(headingLevel("## Gradient descent")).toBe(2);
    expect(headingLevel("3.2 Backpropagation Through Time")).toBe(2);
    expect(headingLevel("Lecture 7")).toBe(1);
    expect(headingLevel("The gradient is computed by the chain rule.")).toBe(0);
  });

  it("recognises equations without flagging prose", () => {
    expect(isEquationLine("L(θ) = −Σ y log ŷ")).toBe(true);
    expect(isEquationLine("\\frac{\\partial L}{\\partial w} = \\delta x")).toBe(true);
    expect(isEquationLine("We minimise the loss using stochastic gradient descent on mini-batches.")).toBe(false);
    // Plain-text notation with function names (seen in real student notes)
    expect(isEquationLine("Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V")).toBe(true);
    expect(isEquationLine("p(y|x) = exp(w_y · x) / Z")).toBe(true);
    expect(isEquationLine("The learning rate = 0.01 worked best for every experiment we tried")).toBe(false);
  });

  it("keeps fenced code blocks intact", () => {
    const blocks = toBlocks(textToPage("Intro\n\n```python\ndef f(x):\n\n    return x\n```\nAfter").lines);
    const code = blocks.find((b) => b.kind === "code");
    expect(code?.lines.map((l) => l.text).join("\n")).toBe("```python\ndef f(x):\n\n    return x\n```");
  });
});

describe("chunkDocument", () => {
  it("never crosses pages and carries heading paths across them", () => {
    const pages = [
      { page: 1, lines: [{ text: "# Backpropagation" }, { text: "The chain rule lets us compute gradients layer by layer." }] },
      { page: 2, lines: [{ text: "Each layer receives the upstream gradient." }] },
    ];
    const chunks = chunkDocument(pages);
    expect(chunks.map((c) => c.page)).toEqual([1, 2]);
    expect(chunks[1]!.headingPath).toEqual(["Backpropagation"]);
  });

  it("flags equations and code and preserves their text verbatim", () => {
    const eq = "∂L/∂W = δ · xᵀ";
    const chunks = chunkDocument([{ page: 1, lines: [{ text: "Gradient:" }, { text: "" }, { text: eq }, { text: "" }, { text: "    for x in batch:" }] }]);
    expect(chunks.some((c) => c.hasEquation && c.text.includes(eq))).toBe(true);
    expect(chunks.some((c) => c.hasCode)).toBe(true);
  });

  it("does not emit heading-only chunks when a subheading follows immediately", () => {
    const chunks = chunkDocument([textToPage("# Transformer notes\n\n## Attention\n\nAttention maps queries to outputs.")]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.headingPath).toEqual(["Transformer notes", "Attention"]);
    expect(chunks[0]!.text).toContain("# Transformer notes");
  });

  it("produces line ranges for text notes and unions bounding boxes for PDFs", () => {
    const [note] = chunkDocument([textToPage("# Notes\nline two\nline three")]);
    expect(note).toMatchObject({ lineStart: 1, lineEnd: 3 });

    const [pdf] = chunkDocument([{ page: 4, lines: [{ text: "a", bbox: [0.1, 0.2, 0.5, 0.25] }, { text: "b", bbox: [0.1, 0.25, 0.7, 0.3] }] }]);
    expect(pdf!.bbox).toEqual([0.1, 0.2, 0.7, 0.3]);
  });

  it("splits oversized paragraphs on line boundaries", () => {
    const lines = Array.from({ length: 200 }, (_, i) => ({ text: `Sentence number ${i} about convolutional networks and receptive fields` }));
    const chunks = chunkDocument([{ page: 1, lines }], { targetTokens: 200, maxTokens: 300 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(320);
    expect(chunks.map((c) => c.text).join("\n")).toBe(lines.map((l) => l.text).join("\n"));
  });
});

describe("stripRunningHeadersFooters", () => {
  const page = (n: number, body: string) => ({
    page: n,
    lines: [
      { text: "Advanced ML", bbox: [0.05, 0.02, 0.3, 0.05] as [number, number, number, number] },
      { text: body, bbox: [0.05, 0.3, 0.9, 0.35] as [number, number, number, number] },
      { text: `Lecture 7 · slide ${n}`, bbox: [0.05, 0.94, 0.4, 0.97] as [number, number, number, number] },
    ],
  });
  it("drops lines repeated near the page edges, ignoring page numbers", () => {
    const out = stripRunningHeadersFooters([page(1, "Graphs"), page(2, "Chain rule"), page(3, "Linear layer"), page(4, "Cost")]);
    expect(out.map((p) => p.lines.map((l) => l.text))).toEqual([["Graphs"], ["Chain rule"], ["Linear layer"], ["Cost"]]);
  });
  it("keeps body text that happens to repeat, and short documents untouched", () => {
    const pages = [1, 2, 3].map((n) => ({ page: n, lines: [{ text: "Definition", bbox: [0.1, 0.5, 0.3, 0.55] as [number, number, number, number] }] }));
    expect(stripRunningHeadersFooters(pages)).toEqual(pages);
    const two = [page(1, "a"), page(2, "b")];
    expect(stripRunningHeadersFooters(two)).toEqual(two);
  });
});
