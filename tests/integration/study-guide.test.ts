import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { chunkDocument } from "@/lib/chunking/document";
import { chunkTranscript } from "@/lib/chunking/transcript";
import { db } from "@/lib/db";
import type { ChatModel, JsonRequest, JsonResponse } from "@/server/ai";
import { runGenerationJob } from "@/server/generation/run";
import { OutlineSchema } from "@/server/generation/study-guide/schemas";

/**
 * Runs the real study-guide generator against Postgres with a scripted model.
 * The model cites one real excerpt per passage, one fabricated excerpt, and
 * one external fact — the validator must keep only the real ones and anchor
 * them to the exact transcript segment / slide page.
 */

const reachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

const TRANSCRIPT = [
  "Today is about backpropagation, which is the chain rule applied to a computational graph.",
  "The forward pass evaluates nodes in topological order and caches the intermediate values.",
  "Then the gradient with respect to W is delta z times x transpose, an outer product.",
  "If x fans out to several children, gradients from each branch add.",
];

class ScriptedModel implements ChatModel {
  readonly provider = "scripted";
  readonly model = "scripted-1";
  calls: string[] = [];
  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    this.calls.push(req.prompt);
    const refs = [...req.prompt.matchAll(/<passage ref="(C\d+)"[^>]*>\n([\s\S]*?)\n<\/passage>/g)].map((m) => ({ ref: m[1]!, text: m[2]! }));
    const usage = { inputTokens: 1000, outputTokens: 200 };
    if ((req.schema as ZodType) === (OutlineSchema as ZodType)) {
      const data = {
        title: "Backpropagation",
        sections: [
          { key: "s1", level: 1, kind: "CONCEPTS", title: "The chain rule on graphs", learningObjective: "Explain backprop", sourceRefs: refs.map((r) => r.ref) },
          { key: "s2", level: 2, kind: "EQUATIONS", title: "Linear layer gradients", learningObjective: "Derive dW", sourceRefs: [refs[0]!.ref] },
        ],
      };
      return { data: OutlineSchema.parse(data) as T, usage, model: this.model };
    }
    // Section: cite the first sentence of every passage verbatim, plus two bad claims.
    const claims = refs.map((r, i) => ({
      key: `k${i + 1}`,
      claimType: "source_grounded" as const,
      citations: [{ ref: r.ref, excerpt: r.text.replace(/^\[Speaker \d+\]\s*/, "").split(/(?<=\.)\s/)[0]!.slice(0, 200) }],
    }));
    const n = claims.length;
    claims.push({ key: `k${n + 1}`, claimType: "source_grounded", citations: [{ ref: refs[0]!.ref, excerpt: "the learning rate must always be 0.1 for stability" }] });
    claims.push({ key: `k${n + 2}`, claimType: "external" as never, citations: [] });
    const content = claims.map((c) => `- [[claim:${c.key}]]Statement ${c.key}.[[/claim]]`).join("\n");
    const data = { content, claims, aiCreatedPractice: false, confidence: 0.9, warnings: [] };
    return { data: req.schema.parse(data), usage, model: this.model };
  }
}

describe.skipIf(!reachable)("study guide generation (integration)", () => {
  const ids = { user: randomUUID(), ws: randomUUID(), set: randomUUID(), video: randomUUID(), slides: randomUUID(), job: randomUUID() };

  beforeAll(async () => {
    await db.user.create({ data: { id: ids.user, email: `it-${ids.user}@lectureforge.test`, name: "IT" } });
    await db.workspace.create({ data: { id: ids.ws, name: "IT", ownerId: ids.user, members: { create: { userId: ids.user } } } });
    await db.studySet.create({ data: { id: ids.set, workspaceId: ids.ws, createdById: ids.user, title: "IT set", citationStrictness: "STRICT" } });
    const rights = { rightsConfirmedAt: new Date(), rightsConfirmedBy: ids.user, status: "READY" as const };
    await db.source.create({ data: { id: ids.video, studySetId: ids.set, kind: "VIDEO", title: "Lecture", ...rights } });
    await db.source.create({ data: { id: ids.slides, studySetId: ids.set, kind: "SLIDES", title: "Slides", ...rights } });

    const segs = TRANSCRIPT.map((text, index) => ({ index, startMs: index * 10_000, endMs: index * 10_000 + 9_000, speaker: null, text }));
    await db.transcript.create({
      data: { sourceId: ids.video, provider: "test", segments: { createMany: { data: segs.map((s) => ({ ...s, originalText: s.text })) } } },
    });
    // One chunk spanning all four segments, so anchors must be narrowed to a segment.
    const [tc] = chunkTranscript(segs, { targetTokens: 1000, maxTokens: 2000 });
    await db.extractedChunk.create({
      data: {
        studySetId: ids.set, sourceId: ids.video, index: 0, kind: "TRANSCRIPT", text: tc!.text, tokenCount: tc!.tokenCount, contentHash: "x",
        startMs: tc!.startMs, endMs: tc!.endMs, headingPath: [], metadata: { firstSegment: 0, lastSegment: 3 },
      },
    });
    const [slide] = chunkDocument([{ page: 4, lines: [{ text: "Gradients from multiple children are summed at the parent node.", bbox: [0.1, 0.4, 0.9, 0.45] }] }]);
    await db.extractedChunk.create({
      data: {
        studySetId: ids.set, sourceId: ids.slides, index: 0, kind: "PAGE_TEXT", text: slide!.text, tokenCount: slide!.tokenCount, contentHash: "y",
        pageStart: 4, pageEnd: 4, regions: [{ page: 4, bbox: slide!.bbox }], headingPath: [],
      },
    });
    await db.generationJob.create({ data: { id: ids.job, studySetId: ids.set, userId: ids.user, type: "GENERATE_STUDY_GUIDE", payload: { style: "EXAM_REVISION" } } });
  });

  afterAll(async () => {
    await db.studySet.deleteMany({ where: { id: ids.set } });
    await db.workspace.deleteMany({ where: { id: ids.ws } });
    await db.user.deleteMany({ where: { id: ids.user } });
    await db.$disconnect();
  });

  it("generates a guide whose surviving claims are all verified and precisely anchored", async () => {
    const model = new ScriptedModel();
    await runGenerationJob(ids.job, model);

    const job = await db.generationJob.findUniqueOrThrow({ where: { id: ids.job } });
    expect(job).toMatchObject({ status: "SUCCEEDED", provider: "scripted", model: "scripted-1", promptVersion: "study-guide/v1" });
    expect(job.inputTokens).toBe(3000); // outline + 2 sections

    const guide = await db.studyGuide.findFirstOrThrow({
      where: { generationJobId: ids.job },
      include: { sections: { orderBy: { order: "asc" }, include: { anchors: true } } },
    });
    expect(guide).toMatchObject({ title: "Backpropagation", style: "EXAM_REVISION", status: "NEEDS_REVIEW" });
    expect(guide.sections).toHaveLength(2);
    expect(guide.sections[1]!.parentId).toBe(guide.sections[0]!.id);

    const all = guide.sections.flatMap((s) => s.anchors);
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((a) => a.verified)).toBe(true);
    // Fabricated and external statements were removed from the stored text.
    for (const s of guide.sections) {
      expect(s.warnings.join(" ")).toMatch(/removed/);
      const markers = [...s.content.matchAll(/\[\[claim:(k\d+)(?:@\w+)?\]\]/g)].map((m) => m[1]);
      expect(new Set(s.anchors.map((a) => a.claimKey))).toEqual(new Set(markers));
    }

    // The transcript citation is narrowed to the first segment, not the whole chunk.
    const videoAnchor = all.find((a) => a.sourceId === ids.video)!;
    expect(videoAnchor).toMatchObject({ startMs: 0, endMs: 9_000 });
    expect(videoAnchor.transcriptSegmentId).not.toBeNull();
    const slideAnchor = all.find((a) => a.sourceId === ids.slides)!;
    expect(slideAnchor).toMatchObject({ page: 4, region: { page: 4, bbox: [0.1, 0.4, 0.9, 0.45] } });

    // Every section has a version-1 revision.
    expect(await db.artifactRevision.count({ where: { studySetId: ids.set, origin: "ai", version: 1 } })).toBe(2);

    // Passages were sent with stable refs.
    expect(model.calls[0]).toContain('<passage ref="C1"');
  });

  it("refuses to regenerate an edited section without confirmation, then regenerates with it", async () => {
    const section = await db.studyGuideSection.findFirstOrThrow({ where: { guide: { generationJobId: ids.job } }, orderBy: { order: "asc" } });
    await db.studyGuideSection.update({ where: { id: section.id }, data: { editedByUser: true, content: "my notes" } });

    const regen = await db.generationJob.create({
      data: { studySetId: ids.set, userId: ids.user, type: "REGENERATE_ITEM", payload: { entityType: "StudyGuideSection", sectionId: section.id } },
    });
    await expect(runGenerationJob(regen.id, new ScriptedModel())).rejects.toThrow(/edits/);

    const forced = await db.generationJob.create({
      data: { studySetId: ids.set, userId: ids.user, type: "REGENERATE_ITEM", payload: { entityType: "StudyGuideSection", sectionId: section.id, force: true } },
    });
    await runGenerationJob(forced.id, new ScriptedModel());
    const after = await db.studyGuideSection.findUniqueOrThrow({ where: { id: section.id } });
    expect(after).toMatchObject({ editedByUser: false, version: 2 });
    expect(after.content).not.toBe("my notes");
    expect(await db.artifactRevision.count({ where: { entityId: section.id } })).toBe(2);
  });
});
