import "dotenv/config";
// Keyword retrieval only: keeps the test independent of a running embedding model.
process.env.EMBEDDING_PROVIDER = "none";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { TutorStreamEventWire } from "@/lib/contracts/tutor";
import type { OllamaMessage } from "@/server/ai/ollama";
import { runReindexJob } from "@/server/pipeline/reindex";
import type { TutorModel, TutorStreamEvent } from "@/server/tutor/model";
import { answerTurn } from "@/server/tutor/service";
import { patchSegment } from "@/server/services/viewer";

const reachable = await db.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

/** Replies with a fixed text and records what it was sent. */
class ScriptedTutor implements TutorModel {
  readonly provider = "scripted";
  readonly model = "scripted-tutor";
  sent: OllamaMessage[] = [];
  constructor(private readonly reply: string) {}
  async *stream(messages: OllamaMessage[]): AsyncGenerator<TutorStreamEvent> {
    this.sent = messages;
    for (const piece of this.reply.match(/.{1,12}/gs) ?? []) yield { delta: piece };
    yield { done: true, inputTokens: 100, outputTokens: 20 };
  }
}

const LINES = [
  "Today is about backpropagation, which is the chain rule applied to a computational graph.",
  "Then the gradient with respect to W is delta z times x transpose, an outer product.",
  "If x fans out to several children, gradients from each branch add.",
];

describe.skipIf(!reachable)("tutor and transcript corrections (integration)", () => {
  const ids = { user: randomUUID(), ws: randomUUID(), set: randomUUID(), source: randomUUID(), convo: randomUUID() };

  beforeAll(async () => {
    await db.user.create({ data: { id: ids.user, email: `it-${ids.user}@lectureforge.test`, name: "IT" } });
    await db.workspace.create({ data: { id: ids.ws, name: "IT", ownerId: ids.user, members: { create: { userId: ids.user } } } });
    await db.studySet.create({ data: { id: ids.set, workspaceId: ids.ws, createdById: ids.user, title: "Backprop IT" } });
    await db.source.create({
      data: { id: ids.source, studySetId: ids.set, kind: "VIDEO", title: "Lecture", status: "READY", rightsConfirmedAt: new Date(), rightsConfirmedBy: ids.user },
    });
    await db.transcript.create({
      data: {
        sourceId: ids.source,
        provider: "test",
        segments: { createMany: { data: LINES.map((text, index) => ({ index, startMs: index * 10_000, endMs: index * 10_000 + 9_000, text, originalText: text })) } },
      },
    });
    // Build chunks the same way corrections do.
    const job = await db.generationJob.create({ data: { studySetId: ids.set, sourceId: ids.source, userId: ids.user, type: "REINDEX_SOURCE" } });
    await runReindexJob(job.id);
    await db.tutorConversation.create({ data: { id: ids.convo, studySetId: ids.set, userId: ids.user, title: "t" } });
  });

  afterAll(async () => {
    await db.studySet.deleteMany({ where: { id: ids.set } });
    await db.workspace.deleteMany({ where: { id: ids.ws } });
    await db.user.deleteMany({ where: { id: ids.user } });
    await db.$disconnect();
  });

  it("answers from retrieved passages and keeps only valid citations", async () => {
    const set = await db.studySet.findUniqueOrThrow({ where: { id: ids.set } });
    const model = new ScriptedTutor("The weight gradient is an outer product [C1]. Fabricated [C5]. What shape is it?");
    const events: TutorStreamEventWire[] = [];
    await answerTurn({ set, conversationId: ids.convo, userId: ids.user, text: "What is the gradient with respect to W in a linear layer?", action: null, image: null, model, emit: (e) => events.push(e) });

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("user");
    expect(types[1]).toBe("sources");
    expect(types.at(-1)).toBe("done");
    const sources = events.find((e) => e.type === "sources") as Extract<TutorStreamEventWire, { type: "sources" }>;
    expect(sources.noSourceMatch).toBe(false);
    expect(sources.anchors.length).toBeGreaterThan(0);

    // The model saw the passages and the Socratic rules.
    expect(model.sent[0]!.role).toBe("system");
    expect(model.sent.at(-1)!.content).toMatch(/<passage ref="C1"/);

    const done = events.at(-1) as Extract<TutorStreamEventWire, { type: "done" }>;
    expect(done.message.content).toBe("The weight gradient is an outer product [C1]. Fabricated. What shape is it?");
    expect(done.message.anchors.map((a) => a.ref)).toEqual(["C1"]);
    // Pinpointed to the line the cited sentence draws on, not the whole passage.
    expect(done.message.anchors[0]).toMatchObject({ startMs: 10_000, endMs: 19_000 });
    expect(done.message.anchors[0]!.excerpt).toContain("outer product");
    const stored = await db.tutorMessage.findFirstOrThrow({ where: { conversationId: ids.convo, role: "ASSISTANT" } });
    expect(stored.warnings).toContain("removed_invalid_citations");
  });

  it("says so when nothing in the sources matches", async () => {
    const set = await db.studySet.findUniqueOrThrow({ where: { id: ids.set } });
    const model = new ScriptedTutor("I cannot find that in your uploaded sources.");
    const events: TutorStreamEventWire[] = [];
    await answerTurn({ set, conversationId: ids.convo, userId: ids.user, text: "Who painted the Mona Lisa?", action: null, image: null, model, emit: (e) => events.push(e) });
    const sources = events.find((e) => e.type === "sources") as Extract<TutorStreamEventWire, { type: "sources" }>;
    expect(sources).toMatchObject({ noSourceMatch: true, anchors: [] });
    expect(model.sent.at(-1)!.content).toContain("No passage in the student's sources matches this question.");
    // Earlier citations are stripped from replayed history.
    expect(model.sent.some((m) => m.role === "assistant" && /\[C\d/.test(m.content))).toBe(false);
  });

  it("rebuilds passages without lines marked inaccurate, keeping the original wording for undo", async () => {
    const seg = await db.transcriptSegment.findFirstOrThrow({ where: { transcript: { sourceId: ids.source }, index: 2 } });
    await patchSegment(ids.user, seg.id, { flaggedInaccurate: true, flagNote: "misheard" });
    const corrected = await db.transcriptSegment.findFirstOrThrow({ where: { transcript: { sourceId: ids.source }, index: 1 } });
    const view = await patchSegment(ids.user, corrected.id, { text: "Then the gradient with respect to W is delta z times x transpose." });
    expect(view).toMatchObject({ edited: true, originalText: LINES[1] });

    // Edits queue exactly one debounced re-index.
    const queued = await db.generationJob.findMany({ where: { sourceId: ids.source, type: "REINDEX_SOURCE", status: "QUEUED" } });
    expect(queued).toHaveLength(1);
    await runReindexJob(queued[0]!.id);

    const text = (await db.extractedChunk.findMany({ where: { sourceId: ids.source } })).map((c) => c.text).join(" ");
    expect(text).not.toContain("fans out");
    expect(text).not.toContain("an outer product");
    expect(text).toContain("delta z times x transpose.");

    const reverted = await patchSegment(ids.user, corrected.id, { revert: true });
    expect(reverted).toMatchObject({ edited: false, text: LINES[1] });
  });
});
