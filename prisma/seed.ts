/**
 * Seeds a demo learner with one processed study set: a graduate ML lecture on
 * backpropagation. The recording is a generated placeholder video with a
 * seeded transcript; the slides are a generated PDF parsed by the real
 * pipeline. Passages are embedded with the configured (local) embedding model
 * when it is reachable, and a demo study guide is replayed through the real
 * generator, so everything can be explored without any API keys.
 *
 * Demo login: demo@lectureforge.test / SEED_DEMO_PASSWORD from .env
 */
import "dotenv/config";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient, type ProcessingStage } from "@prisma/client";
import { keys, uploadFile } from "../src/lib/storage";
import { createContext } from "../src/server/pipeline/context";
import { parsePdf, segmentDocument } from "../src/server/pipeline/stages/documents";
import { indexChunks } from "../src/server/pipeline/stages/index-chunks";
import { segmentTranscript } from "../src/server/pipeline/stages/transcribe";
import { makePlaceholderVideo, makeSlidesPdf, type SlideSpec } from "./demo-media";

const db = new PrismaClient();
const EMAIL = "demo@lectureforge.test";

const TRANSCRIPT: [number, string][] = [
  [0, "Okay, let's get started. Today is about backpropagation, which is really just the chain rule applied systematically to a computational graph."],
  [9_500, "Recall our setup. We have parameters theta, a loss L of theta, and we want the gradient of L with respect to every parameter."],
  [19_000, "A computational graph is a directed acyclic graph where each node computes a function of its inputs. The loss is the final node."],
  [30_200, "The forward pass evaluates nodes in topological order and caches the intermediate values. We will need those cached values on the way back."],
  [42_000, "Now the key quantity. For any node z, define the upstream gradient delta z as the partial derivative of L with respect to z."],
  [53_500, "The chain rule says: the gradient at an input x equals the sum over every child z of x, of delta z times the local derivative of z with respect to x."],
  [66_000, "That sum matters. If x fans out to several children, gradients from each branch add. Forgetting this is the most common bug in hand-written backprop."],
  [78_400, "Let's do a linear layer. z equals W x plus b. The upstream gradient delta z is a vector the same shape as z."],
  [88_900, "Then the gradient with respect to W is delta z times x transpose, an outer product. The gradient with respect to b is just delta z."],
  [99_000, "And the gradient passed further back, to x, is W transpose times delta z. Check the shapes every time: that is your best debugging tool."],
  [110_500, "For an elementwise nonlinearity like ReLU, the local derivative is one where the input was positive and zero elsewhere, so we just mask delta."],
  [121_000, "Cost: the backward pass costs roughly the same order as the forward pass, about two to three times. That's why reverse mode wins when you have one scalar loss and millions of parameters."],
  [134_000, "Forward-mode differentiation would need one pass per input dimension. Reverse mode needs one pass per output, and we have one output, the loss."],
  [146_500, "Memory is the trade-off. We store activations from the forward pass. Gradient checkpointing recomputes some of them to save memory."],
  [158_000, "Finally, always verify with a numerical gradient check: compare against the centered difference L of theta plus h minus L of theta minus h, over two h."],
];

const SLIDES: SlideSpec[] = [
  { title: "Lecture 7: Backpropagation and Computational Graphs", lines: ["Advanced Machine Learning — Graduate Seminar"] },
  {
    title: "1 Computational Graphs",
    lines: ["A directed acyclic graph whose nodes compute differentiable functions of their parents.", "Forward pass: evaluate in topological order, cache intermediates."],
  },
  {
    title: "2 The Chain Rule on Graphs",
    lines: ["δ_z ≡ ∂L/∂z", "", "∂L/∂x = Σ_{z ∈ children(x)} δ_z · ∂z/∂x", "", "Gradients from multiple children are summed."],
  },
  {
    title: "3 Linear Layer",
    lines: ["z = W x + b", "", "∂L/∂W = δ_z xᵀ    ∂L/∂b = δ_z    ∂L/∂x = Wᵀ δ_z", "", "def linear_backward(dz, x, W):", "    return dz @ x.T, dz, W.T @ dz  # dW, db, dx"],
  },
  {
    title: "4 Cost and Verification",
    lines: ["Reverse mode: one backward pass per scalar output; cost ≈ 2–3× forward.", "Gradient check: (L(θ + h) − L(θ − h)) / 2h"],
  },
];

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD;
  if (!password || password.length < 10) throw new Error("Set SEED_DEMO_PASSWORD (10+ chars) in .env before seeding.");

  await db.user.deleteMany({ where: { email: EMAIL } });
  const user = await db.user.create({
    data: { email: EMAIL, name: "Demo Learner", passwordHash: await bcrypt.hash(password, 12) },
  });
  const ws = await db.workspace.create({
    data: { name: "Demo workspace", ownerId: user.id, members: { create: { userId: user.id, role: "OWNER" } } },
  });
  const set = await db.studySet.create({
    data: {
      workspaceId: ws.id,
      createdById: user.id,
      title: "Lecture 7 — Backpropagation and Computational Graphs",
      course: "Advanced Machine Learning",
      subject: "Machine learning",
      learnerLevel: "GRADUATE",
      examDate: new Date(Date.now() + 21 * 86_400_000),
      outputTypes: ["STUDY_GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES", "TUTOR"],
    },
  });

  const now = new Date();
  const rights = { rightsConfirmedAt: now, rightsConfirmedBy: user.id };

  const workDir = await mkdtemp(join(tmpdir(), "lectureforge-seed-"));
  const prefixFor = (sourceId: string) => keys.sourcePrefix(ws.id, set.id, sourceId);

  /** Runs pipeline steps for a seeded source with a real ingest job, context and event log. */
  async function withPipeline(source: { id: string }, plan: ProcessingStage[], steps: (ctx: ReturnType<typeof createContext>) => Promise<void>) {
    const job = await db.generationJob.create({
      data: { studySetId: set.id, sourceId: source.id, userId: user.id, type: "SOURCE_INGEST", status: "RUNNING", startedAt: now, events: { create: { message: "Seeded demo source" } } },
    });
    const full = await db.source.findUniqueOrThrow({ where: { id: source.id }, include: { assets: true } });
    const ctx = createContext({ job, source: full, studySet: set, workDir, storagePrefix: prefixFor(source.id) }, plan);
    await steps(ctx);
    await db.generationJob.update({ where: { id: job.id }, data: { status: "SUCCEEDED", stage: "COMPLETE", progress: 1, finishedAt: new Date() } });
    await ctx.log("INFO", "Ready to study");
  }

  async function embed(ctx: ReturnType<typeof createContext>) {
    await ctx.enter("INDEXING");
    try {
      await indexChunks(ctx);
    } catch (err) {
      console.warn(`  Embedding skipped (${(err as Error).message}). Run "npm run search:reindex" once the embedding model is reachable.`);
    }
  }

  // Lecture recording: placeholder video + seeded transcript
  const durationMs = 170_000;
  const videoPath = join(workDir, "lecture07-placeholder.mp4");
  await makePlaceholderVideo(videoPath, durationMs / 1000);
  const videoSize = BigInt((await stat(videoPath)).size);
  const video = await db.source.create({
    data: {
      studySetId: set.id,
      kind: "VIDEO",
      status: "READY",
      title: "Lecture 7 recording (demo placeholder video)",
      originalFilename: "lecture07-placeholder.mp4",
      mimeType: "video/mp4",
      sizeBytes: videoSize,
      durationMs,
      language: "en",
      processedAt: now,
      ...rights,
    },
  });
  const videoKey = keys.original(prefixFor(video.id), "lecture07-placeholder.mp4");
  await uploadFile(videoKey, videoPath, "video/mp4");
  await db.sourceAsset.create({ data: { sourceId: video.id, role: "ORIGINAL", storageKey: videoKey, mimeType: "video/mp4", sizeBytes: videoSize } });
  const segments = TRANSCRIPT.map(([start, text], index) => ({
    index,
    startMs: start,
    endMs: TRANSCRIPT[index + 1]?.[0] ?? durationMs,
    speaker: "Speaker 1",
    text,
  }));
  await db.transcript.create({
    data: {
      sourceId: video.id,
      language: "en",
      provider: "seed",
      segments: { createMany: { data: segments.map((s) => ({ ...s, originalText: s.text, confidence: 0.95 })) } },
    },
  });
  await withPipeline(video, ["SEGMENTING", "INDEXING"], async (ctx) => {
    await ctx.enter("SEGMENTING");
    await segmentTranscript(ctx, segments);
    await embed(ctx);
  });

  // Slides: a real PDF, parsed and segmented by the document pipeline
  const pdfPath = join(workDir, "lecture07-slides.pdf");
  await makeSlidesPdf(pdfPath, SLIDES);
  const pdfSize = BigInt((await stat(pdfPath)).size);
  const slides = await db.source.create({
    data: {
      studySetId: set.id,
      kind: "SLIDES",
      status: "READY",
      title: "Lecture 7 slides",
      originalFilename: "lecture07-slides.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdfSize,
      processedAt: now,
      ...rights,
    },
  });
  const pdfKey = keys.derived(prefixFor(slides.id), "slides.pdf");
  await uploadFile(pdfKey, pdfPath, "application/pdf");
  await db.sourceAsset.create({ data: { sourceId: slides.id, role: "NORMALIZED_PDF", storageKey: pdfKey, mimeType: "application/pdf", sizeBytes: pdfSize } });
  await withPipeline(slides, ["PARSING_DOCUMENT", "SEGMENTING", "INDEXING"], async (ctx) => {
    await ctx.enter("PARSING_DOCUMENT");
    const pages = await parsePdf(ctx, pdfPath);
    await ctx.enter("SEGMENTING");
    await segmentDocument(ctx, pages, "PAGE_TEXT");
    await embed(ctx);
  });
  await rm(workDir, { recursive: true, force: true });

  const chunkCount = await db.extractedChunk.count({ where: { studySetId: set.id } });
  const embedded = await db.extractedChunk.count({ where: { studySetId: set.id, embeddingModel: { not: null } } });
  console.log(`Seeded ${EMAIL} with study set "${set.title}" (${chunkCount} passages, ${embedded} embedded).`);

  // Demo study guide, replayed through the real generator and citation validator.
  const guideJob = await db.generationJob.create({
    data: { studySetId: set.id, userId: user.id, type: "GENERATE_STUDY_GUIDE", payload: { style: "DETAILED_NOTES" } },
  });
  const { runGenerationJob } = await import("../src/server/generation/run");
  const { DemoFixtureModel } = await import("./demo-guide");
  await runGenerationJob(guideJob.id, new DemoFixtureModel());
  const result = (await db.generationJob.findUniqueOrThrow({ where: { id: guideJob.id } })).result as Record<string, number>;
  console.log(`Demo study guide: ${result.sections} sections, ${result.verified}/${result.proposed} statements verified, ${result.dropped} removed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
