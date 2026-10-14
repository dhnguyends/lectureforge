import { describe, expect, it } from "vitest";
import { markersBalanced, markersToLinks, parseClaims } from "@/lib/citations/markers";
import { findExcerpt, locateInLines, locateInSegments, pinpoint, sentencesCiting, verifyExcerpt } from "@/lib/citations/verify";
import { buildOrTsQuery, reciprocalRankFusion } from "@/server/retrieval";
import type { SectionOutput } from "@/server/generation/study-guide/schemas";
import { unsupportedSymbols, validateSection, type Passage } from "@/server/generation/study-guide/validate";

const SLIDE = "∂L/∂W = δ_z xᵀ    ∂L/∂b = δ_z    ∂L/∂x = Wᵀ δ_z\nGradients from multiple children are summed.";
const TRANSCRIPT =
  "[Speaker 1] Then the gradient with respect to W is delta z times x transpose, an outer product. The gradient with respect to b is just delta z.";

describe("verifyExcerpt", () => {
  it("accepts verbatim excerpts despite case, whitespace, quotes and speaker labels", () => {
    expect(verifyExcerpt("the gradient with respect to W is delta z times x transpose", TRANSCRIPT)).toBe(true);
    expect(verifyExcerpt("Gradients   from multiple CHILDREN are summed", SLIDE)).toBe(true);
    expect(verifyExcerpt("“an outer product”", 'it is "an outer product" here')).toBe(true);
  });

  it("accepts ellipsis gaps only when every piece appears in order", () => {
    expect(verifyExcerpt("the gradient with respect to W … an outer product", TRANSCRIPT)).toBe(true);
    expect(verifyExcerpt("an outer product … the gradient with respect to W", TRANSCRIPT)).toBe(false);
  });

  it("rejects paraphrases and trivially short excerpts", () => {
    expect(verifyExcerpt("the weight gradient equals the outer product of delta and x", TRANSCRIPT)).toBe(false);
    expect(verifyExcerpt("delta z", TRANSCRIPT)).toBe(false);
  });

  it("reports the matched span", () => {
    expect(findExcerpt("gradients from multiple children", SLIDE)).not.toBeNull();
  });
});

describe("locateInSegments", () => {
  const segments = [
    { id: "a", index: 7, startMs: 78_400, endMs: 88_900, text: "Let's do a linear layer. z equals W x plus b." },
    { id: "b", index: 8, startMs: 88_900, endMs: 99_000, text: "Then the gradient with respect to W is delta z times x transpose, an outer product." },
    { id: "c", index: 9, startMs: 99_000, endMs: 110_500, text: "And the gradient passed further back, to x, is W transpose times delta z." },
  ];

  it("narrows a citation to the segment that contains it", () => {
    const hit = locateInSegments("gradient with respect to W is delta z times x transpose", segments);
    expect(hit).toMatchObject({ startMs: 88_900, endMs: 99_000, first: { id: "b" }, last: { id: "b" } });
  });

  it("spans segment boundaries", () => {
    const hit = locateInSegments("an outer product. And the gradient passed further back", segments);
    expect(hit).toMatchObject({ startMs: 88_900, endMs: 110_500 });
  });

  it("returns null when the excerpt is not in the transcript", () => {
    expect(locateInSegments("convolution kernels share weights", segments)).toBeNull();
  });
});

const passages: Passage[] = [
  { ref: "C1", chunkId: "chunk-1", text: TRANSCRIPT },
  { ref: "C2", chunkId: "chunk-2", text: SLIDE },
];

function output(over: Partial<SectionOutput> = {}): SectionOutput {
  return {
    content: [
      "- [[claim:k1]]The weight gradient is the outer product $\\delta_z x^\\top$.[[/claim]]",
      "- [[claim:k2]]Gradients from several children are added together.[[/claim]]",
      "- [[claim:k3]]Backprop was invented in 1986 by Rumelhart.[[/claim]]",
      "- [[claim:k4]]The bias gradient equals the learning rate.[[/claim]]",
    ].join("\n"),
    claims: [
      { key: "k1", claimType: "source_grounded", citations: [{ ref: "C1", excerpt: "the gradient with respect to W is delta z times x transpose" }] },
      { key: "k2", claimType: "source_grounded", citations: [{ ref: "C2", excerpt: "Gradients from multiple children are summed" }] },
      { key: "k3", claimType: "external", citations: [] },
      // Fabricated support: excerpt does not occur in C1
      { key: "k4", claimType: "source_grounded", citations: [{ ref: "C1", excerpt: "the bias gradient equals the learning rate" }] },
    ],
    aiCreatedPractice: false,
    confidence: 0.9,
    warnings: [],
    ...over,
  };
}

describe("validateSection", () => {
  it("STRICT: keeps verified claims, drops fabricated and external ones", () => {
    const v = validateSection(output(), passages, { strictness: "STRICT", allowExternalKnowledge: false });
    expect(v.claims.map((c) => c.key)).toEqual(["k1", "k2"]);
    expect(v.claims.every((c) => c.verified && c.claimType === "source_grounded")).toBe(true);
    expect(v.content).not.toContain("Rumelhart");
    expect(v.content).not.toContain("learning rate");
    expect(v.content).not.toMatch(/^\s*-\s*$/m); // no empty bullets left behind
    expect(v.stats).toMatchObject({ proposed: 4, kept: 2, dropped: 2, verified: 2, failedCitations: 1 });
    expect(v.warnings.join(" ")).toMatch(/2 statements were removed/);
    expect(v.claimType).toBe("SOURCE_GROUNDED");
  });

  it("BALANCED: keeps an unsupported claim but relabels it as unverified inference", () => {
    const v = validateSection(output(), passages, { strictness: "BALANCED", allowExternalKnowledge: false });
    const k4 = v.claims.find((c) => c.key === "k4");
    expect(k4).toMatchObject({ claimType: "inference", verified: false, citations: [] });
    // The stored marker carries the label so the reader sees it is unverified.
    expect(v.content).toContain("[[claim:k4@unverified]]The bias gradient");
    expect(v.content).toContain("[[claim:k1]]The weight gradient");
    expect(v.warnings.join(" ")).toMatch(/not backed by a verified source excerpt/);
  });

  it("keeps labelled external knowledge only when the study set allows it", () => {
    const v = validateSection(output(), passages, { strictness: "STRICT", allowExternalKnowledge: true });
    expect(v.claims.find((c) => c.key === "k3")?.claimType).toBe("external");
  });

  it("never accepts a citation to a passage that was not offered", () => {
    const v = validateSection(
      output({
        content: "[[claim:k1]]Something.[[/claim]]",
        claims: [{ key: "k1", claimType: "source_grounded", citations: [{ ref: "C99", excerpt: "Gradients from multiple children are summed" }] }],
      }),
      passages,
      { strictness: "STRICT", allowExternalKnowledge: false },
    );
    expect(v.claims).toHaveLength(0);
  });

  it("treats a marker without a claim entry as an uncited statement", () => {
    const v = validateSection(output({ content: "[[claim:k9]]Orphan claim.[[/claim]] Kept text.", claims: [] }), passages, {
      strictness: "STRICT",
      allowExternalKnowledge: false,
    });
    expect(v.content).toBe("Kept text.");
  });

  it("labels AI-created practice and strips markers", () => {
    const v = validateSection(output({ aiCreatedPractice: true }), passages, { strictness: "STRICT", allowExternalKnowledge: false });
    expect(v.claimType).toBe("EXTERNAL");
    expect(v.content).not.toContain("[[claim");
    expect(v.warnings[0]).toMatch(/AI-created practice/);
  });

  it("discounts confidence by the share of verified statements", () => {
    const v = validateSection(output(), passages, { strictness: "STRICT", allowExternalKnowledge: false });
    expect(v.confidence).toBeLessThan(0.9);
    expect(v.confidence).toBeGreaterThan(0.5);
  });
});

describe("claim markers", () => {
  const content = "- [[claim:k1]]A $x^2$ fact.[[/claim]]\n- [[claim:k2@external]]Background.[[/claim]] tail";
  it("parses labels and display numbers", () => {
    expect(parseClaims(content)).toEqual([
      { key: "k1", label: "grounded", number: 1 },
      { key: "k2", label: "external", number: 2 },
    ]);
  });
  it("turns markers into citation links without touching the statement text", () => {
    expect(markersToLinks(content)).toBe("- A $x^2$ fact. [1](#cite-k1)\n- Background. [2](#cite-k2) tail");
  });
  it("detects unbalanced markers", () => {
    expect(markersBalanced("[[claim:k1]]x")).toBe(false);
    expect(markersBalanced(content)).toBe(true);
  });
});

describe("unsupportedSymbols", () => {
  it("flags Greek symbols absent from every passage", () => {
    expect(unsupportedSymbols("Loss $\\mathcal{L}(\\theta) = \\lambda \\|w\\|$", passages)).toEqual(expect.arrayContaining(["θ", "λ"]));
  });
  it("accepts symbols present as a character or spoken name", () => {
    expect(unsupportedSymbols("$\\delta_z x^\\top$", passages)).toEqual([]); // "δ" in slide, "delta" in transcript
  });
});

describe("retrieval helpers", () => {
  it("builds an injection-safe OR query", () => {
    expect(buildOrTsQuery("Why scale by sqrt(d_k)?")).toBe("scale | sqrt | d_k");
    expect(buildOrTsQuery("a & b | !c ) (")).toBeNull();
  });

  it("fuses rankings so items ranked well in both lists win", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["b", "c", "d"],
    ]);
    const order = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(order[0]).toBe("b");
    expect(order.at(-1)).toBe("d");
  });
});

describe("locateInLines", () => {
  const lines = [
    { text: "3 Linear Layer", bbox: [0.06, 0.1, 0.4, 0.17] as [number, number, number, number] },
    { text: "z = W x + b", bbox: [0.06, 0.25, 0.3, 0.3] as [number, number, number, number] },
    { text: "∂L/∂W = δ_z xᵀ    ∂L/∂b = δ_z", bbox: [0.06, 0.4, 0.62, 0.46] as [number, number, number, number] },
    { text: "def linear_backward(dz, x, W):", bbox: [0.08, 0.55, 0.5, 0.6] as [number, number, number, number] },
  ];
  it("boxes only the line the excerpt is on", () => {
    expect(locateInLines("∂L/∂W = δ_z xᵀ", lines)).toEqual([0.06, 0.4, 0.62, 0.46]);
  });
  it("unions boxes when the excerpt spans lines", () => {
    expect(locateInLines("z = W x + b ∂L/∂W", lines)).toEqual([0.06, 0.25, 0.62, 0.46]);
  });
  it("returns null when the excerpt is not on the page", () => {
    expect(locateInLines("softmax attention", lines)).toBeNull();
  });
});

describe("pinpoint / sentencesCiting", () => {
  const reply =
    'The weight gradient is an outer product: "delta z times x transpose" [C1]. Remember that gradients from each branch add [C2]. What shape is it?';
  const segments = [
    { text: "Let's do a linear layer. z equals W x plus b.", startMs: 78_400 },
    { text: "Then the gradient with respect to W is delta z times x transpose, an outer product.", startMs: 88_900 },
    { text: "And the gradient passed further back, to x, is W transpose times delta z.", startMs: 99_000 },
  ];
  it("extracts the sentences that cite a ref", () => {
    expect(sentencesCiting(reply, "C1")).toBe('The weight gradient is an outer product: "delta z times x transpose" .');
    expect(sentencesCiting(reply, "C3")).toBe("");
  });
  it("picks the line the statement draws on", () => {
    expect(pinpoint(sentencesCiting(reply, "C1"), segments)?.startMs).toBe(88_900);
  });
  it("returns null when nothing overlaps enough", () => {
    expect(pinpoint("photosynthesis in plants", segments)).toBeNull();
  });
});
