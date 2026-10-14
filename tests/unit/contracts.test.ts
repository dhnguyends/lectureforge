import { describe, expect, it } from "vitest";
import { CitationAnchorSchema, GeneratedItemBaseSchema } from "@/lib/contracts/generation";
import { CreateSourceInputSchema } from "@/lib/contracts/source";
import { CreateStudySetInputSchema } from "@/lib/contracts/study-set";
import { parseTesseractTsv } from "@/server/providers/ocr";

const uuid = "4f0f3a39-8d2e-4b6a-9a3c-2f1e7d1b9c10";

describe("CreateStudySetInputSchema", () => {
  it("applies safe defaults: sources-only, external knowledge off, strict citations", () => {
    const parsed = CreateStudySetInputSchema.parse({ title: "CS 7643 – Lecture 7" });
    expect(parsed.advanced).toMatchObject({ sourcesOnly: true, allowExternalKnowledge: false, citationStrictness: "STRICT" });
    expect(parsed.outputTypes).toEqual(["STUDY_GUIDE", "FLASHCARDS", "QUIZ"]);
  });

  it("rejects contradictory grounding settings", () => {
    const result = CreateStudySetInputSchema.safeParse({
      title: "x",
      advanced: { sourcesOnly: true, allowExternalKnowledge: true },
    });
    expect(result.success).toBe(false);
  });

  it("validates dates and language codes", () => {
    expect(CreateStudySetInputSchema.safeParse({ title: "x", examDate: "2026-12-14" }).success).toBe(true);
    expect(CreateStudySetInputSchema.safeParse({ title: "x", examDate: "14/12/2026" }).success).toBe(false);
    expect(CreateStudySetInputSchema.safeParse({ title: "x", language: "pt-BR" }).success).toBe(true);
    expect(CreateStudySetInputSchema.safeParse({ title: "x", language: "English" }).success).toBe(false);
  });
});

describe("CreateSourceInputSchema", () => {
  it("requires explicit rights confirmation", () => {
    const base = { type: "upload", filename: "a.mp4", mimeType: "video/mp4", sizeBytes: 10 };
    expect(CreateSourceInputSchema.safeParse(base).success).toBe(false);
    expect(CreateSourceInputSchema.safeParse({ ...base, rightsConfirmed: false }).success).toBe(false);
    expect(CreateSourceInputSchema.safeParse({ ...base, rightsConfirmed: true }).success).toBe(true);
  });
});

describe("CitationAnchorSchema", () => {
  it("requires timestamps for media and pages for documents", () => {
    const base = { sourceId: uuid, chunkId: uuid, excerpt: "the gradient of the loss" };
    expect(CitationAnchorSchema.safeParse({ ...base, sourceType: "video", start: "00:12:41.000", end: "00:13:18.500" }).success).toBe(true);
    expect(CitationAnchorSchema.safeParse({ ...base, sourceType: "video" }).success).toBe(false);
    expect(CitationAnchorSchema.safeParse({ ...base, sourceType: "pdf", page: 12 }).success).toBe(true);
    expect(CitationAnchorSchema.safeParse({ ...base, sourceType: "slide" }).success).toBe(false);
    expect(CitationAnchorSchema.safeParse({ ...base, sourceType: "audio", start: "12:41", end: "13:18" }).success).toBe(false);
  });
});

describe("GeneratedItemBaseSchema", () => {
  const item = { title: "Chain rule", content: "…", confidence: 0.9, warnings: [] };
  it("refuses source-grounded content without anchors", () => {
    expect(GeneratedItemBaseSchema.safeParse({ ...item, claimType: "source_grounded", sourceAnchors: [] }).success).toBe(false);
  });
  it("allows labelled inference without anchors", () => {
    expect(GeneratedItemBaseSchema.safeParse({ ...item, claimType: "inference", sourceAnchors: [] }).success).toBe(true);
  });
});

describe("parseTesseractTsv", () => {
  it("groups words into lines with normalised boxes", () => {
    const tsv = [
      "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
      "1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t",
      "5\t1\t1\t1\t1\t1\t100\t200\t100\t40\t95\tHello",
      "5\t1\t1\t1\t1\t2\t220\t200\t80\t40\t95\tworld",
      "5\t1\t1\t1\t2\t1\t100\t300\t50\t40\t90\tx²",
    ].join("\n");
    const { lines, confidence } = parseTesseractTsv(tsv);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "x²"]);
    expect(lines[0]!.bbox).toEqual([0.1, 0.1, 0.3, 0.12]);
    expect(confidence).toBeCloseTo((95 + 95 + 90) / 3);
  });
});
