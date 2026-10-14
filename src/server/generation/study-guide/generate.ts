import type { GenerationJob, GuideSectionKind, GuideStyle, Prisma, StudySet } from "@prisma/client";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/contracts/generation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import type { Usage } from "@/server/ai";
import { PipelineError } from "@/server/pipeline/errors";
import { loadAllChunks, retrieveChunks, type RetrievedChunk } from "@/server/retrieval";
import { buildAnchors } from "../anchors";
import type { GenerationContext, GenerationResult } from "../registry";
import { formatPassage, outlinePrompt, PROMPT_VERSION, sectionPrompt, systemPrompt, type GuideSettings } from "./prompts";
import { OutlineSchema, SectionOutputSchema, type Outline } from "./schemas";
import { validateSection, type Passage, type ValidatedSection } from "./validate";

/** Outline input: full passages up to this size, condensed beyond it. */
const OUTLINE_FULL_TEXT_TOKENS = 150_000;
/** Passages offered to one section call. */
const SECTION_PASSAGE_TOKENS = 14_000;
const SECTION_RETRIEVAL = 8;

export type StudyGuidePayload = { style?: GuideStyle };
export type RegenerateSectionPayload = {
  entityType: "StudyGuideSection";
  sectionId: string;
  instructions?: string;
  force?: boolean;
};

/** Stable passage refs for a study set: C1…Cn in reading order. */
class PassageIndex {
  readonly byRef = new Map<string, RetrievedChunk>();
  private readonly refById = new Map<string, string>();
  constructor(readonly chunks: RetrievedChunk[]) {
    chunks.forEach((c, i) => {
      const ref = `C${i + 1}`;
      this.byRef.set(ref, c);
      this.refById.set(c.id, ref);
    });
  }
  ref(chunkId: string): string | undefined {
    return this.refById.get(chunkId);
  }
  /** Ordered, de-duplicated, within a token budget (earlier entries win). */
  select(chunkIds: string[], budget: number): { ref: string; chunk: RetrievedChunk }[] {
    const out: { ref: string; chunk: RetrievedChunk }[] = [];
    let tokens = 0;
    for (const id of [...new Set(chunkIds)]) {
      const ref = this.refById.get(id);
      const chunk = ref ? this.byRef.get(ref) : undefined;
      if (!ref || !chunk) continue;
      if (tokens + chunk.tokenCount > budget && out.length > 0) continue;
      out.push({ ref, chunk });
      tokens += chunk.tokenCount;
    }
    // Present in reading order regardless of selection order.
    return out.sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
  }
}

function settingsFor(set: StudySet, style: GuideStyle): GuideSettings {
  return {
    title: set.title,
    course: set.course,
    subject: set.subject,
    learnerLevel: set.learnerLevel,
    language: set.language,
    detailLevel: set.detailLevel,
    citationStrictness: set.citationStrictness,
    sourcesOnly: set.sourcesOnly,
    allowExternalKnowledge: set.allowExternalKnowledge && !set.sourcesOnly,
    preserveEquationsCode: set.preserveEquationsCode,
    style,
  };
}

function addUsage(total: Usage, u: Usage) {
  total.inputTokens += u.inputTokens;
  total.outputTokens += u.outputTokens;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]!, i);
      }
    }),
  );
  return results;
}

async function writeSectionVersion(
  tx: Prisma.TransactionClient,
  sectionId: string,
  studySetId: string,
  version: number,
  origin: "ai" | "user",
  userId: string | null,
) {
  const s = await tx.studyGuideSection.findUniqueOrThrow({ where: { id: sectionId }, include: { anchors: true } });
  await tx.artifactRevision.create({
    data: {
      studySetId,
      entityType: "StudyGuideSection",
      entityId: sectionId,
      version,
      origin,
      userId,
      snapshot: {
        title: s.title,
        content: s.content,
        claimType: s.claimType,
        confidence: s.confidence,
        warnings: s.warnings,
        anchors: s.anchors.map((a) => ({ claimKey: a.claimKey, sourceId: a.sourceId, startMs: a.startMs, endMs: a.endMs, page: a.page, excerpt: a.excerpt })),
      } as Prisma.InputJsonValue,
    },
  });
}

async function generateSection(
  ctx: GenerationContext,
  system: string,
  outline: Outline,
  key: string,
  index: PassageIndex,
  set: StudySet,
  extraChunkIds: string[],
  instructions?: string,
): Promise<{ validated: ValidatedSection; passages: Passage[]; usage: Usage }> {
  const section = outline.sections.find((s) => s.key === key)!;
  const outlineIds = section.sourceRefs.flatMap((r) => (index.byRef.get(r) ? [index.byRef.get(r)!.id] : []));
  const retrieved = await retrieveChunks(set.id, [section.title, section.learningObjective, instructions].filter(Boolean).join(". "), SECTION_RETRIEVAL);
  const selected = index.select([...outlineIds, ...extraChunkIds, ...retrieved.map((c) => c.id)], SECTION_PASSAGE_TOKENS);
  if (!selected.length) throw new PipelineError("No source passages were found for this section.");

  const passagesText = selected.map(({ ref, chunk }) => formatPassage(ref, chunk)).join("\n\n");
  const res = await ctx.model.generateJson({
    system,
    prompt: sectionPrompt(outline, key, passagesText, instructions),
    schema: SectionOutputSchema,
    maxTokens: 24_000,
  });
  const passages: Passage[] = selected.map(({ ref, chunk }) => ({ ref, chunkId: chunk.id, text: chunk.text }));
  const validated = validateSection(res.data, passages, {
    strictness: set.citationStrictness,
    allowExternalKnowledge: set.allowExternalKnowledge && !set.sourcesOnly,
  });
  return { validated, passages, usage: res.usage };
}

function anchorInputs(v: ValidatedSection) {
  return v.claims.flatMap((c) => c.citations.map((citation) => ({ claimKey: c.key, citation })));
}

/** GENERATE_STUDY_GUIDE: retrieve → outline → sections (parallel) → validate → store. */
export async function generateStudyGuide(job: GenerationJob, ctx: GenerationContext): Promise<GenerationResult> {
  const set = await db.studySet.findUniqueOrThrow({ where: { id: job.studySetId } });
  const style = (job.payload as StudyGuidePayload | null)?.style ?? "DETAILED_NOTES";
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };

  const chunks = await loadAllChunks(set.id);
  if (!chunks.length) throw new PipelineError("There is no processed source material to build a guide from yet.");
  const index = new PassageIndex(chunks);
  const system = systemPrompt(settingsFor(set, style));

  // A retry of this job replaces the partial guide from the failed attempt.
  await db.studyGuide.deleteMany({ where: { generationJobId: job.id } });
  const guide = await db.studyGuide.create({
    data: { studySetId: set.id, title: set.title, style, status: "GENERATING", generationJobId: job.id },
  });

  await ctx.progress(0.03, "Planning the guide");
  const totalTokens = chunks.reduce((n, c) => n + c.tokenCount, 0);
  const outlinePassages = [...index.byRef.entries()]
    .map(([ref, c]) =>
      formatPassage(ref, totalTokens <= OUTLINE_FULL_TEXT_TOKENS ? c : { ...c, text: `${c.text.slice(0, 400)}${c.text.length > 400 ? " …" : ""}` }),
    )
    .join("\n\n");
  const outlineRes = await ctx.model.generateJson({ system, prompt: outlinePrompt(outlinePassages), schema: OutlineSchema, maxTokens: 16_000 });
  addUsage(usage, outlineRes.usage);
  const outline = outlineRes.data;
  // Keys must be unique for sectionPrompt to address them.
  outline.sections = outline.sections.map((s, i) => ({ ...s, key: `s${i + 1}` }));
  await db.studyGuide.update({ where: { id: guide.id }, data: { title: outline.title.slice(0, 200) } });
  await ctx.log("INFO", `Outline: ${outline.sections.length} sections`);

  // Parents first so level-2 sections can reference them.
  let currentParent: string | null = null;
  const sectionIds: string[] = [];
  for (const [i, s] of outline.sections.entries()) {
    const level = i === 0 ? 1 : s.level;
    const row: { id: string } = await db.studyGuideSection.create({
      data: {
        guideId: guide.id,
        parentId: level === 2 ? currentParent : null,
        order: i,
        kind: s.kind as GuideSectionKind,
        title: s.title,
        content: "",
        learningObjective: s.learningObjective || null,
        warnings: [],
      },
      select: { id: true },
    });
    if (level === 1) currentParent = row.id;
    sectionIds.push(row.id);
  }

  const totals = { proposed: 0, kept: 0, dropped: 0, verified: 0, failedCitations: 0 };
  let done = 0;
  let lowConfidence = 0;
  await pool(outline.sections, env().GENERATION_CONCURRENCY, async (s, i) => {
    const { validated, usage: u } = await generateSection(ctx, system, outline, s.key, index, set, []);
    addUsage(usage, u);
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += validated.stats[k];
    if (validated.confidence < LOW_CONFIDENCE_THRESHOLD) lowConfidence++;
    const anchors = await buildAnchors(anchorInputs(validated), { studyGuideSectionId: sectionIds[i]! });
    await db.$transaction(async (tx) => {
      await tx.studyGuideSection.update({
        where: { id: sectionIds[i]! },
        data: {
          content: validated.content,
          claimType: validated.claimType,
          confidence: validated.confidence,
          warnings: validated.warnings,
          rationale: `${validated.stats.verified}/${validated.stats.proposed} statements verified against sources`,
        },
      });
      if (anchors.length) await tx.citationAnchor.createMany({ data: anchors });
      await writeSectionVersion(tx, sectionIds[i]!, set.id, 1, "ai", null);
    });
    done++;
    await ctx.progress(0.1 + 0.85 * (done / outline.sections.length), `Wrote “${s.title}” (${done}/${outline.sections.length})`);
  });

  const status = lowConfidence > 0 || totals.dropped > 0 ? "NEEDS_REVIEW" : "READY";
  await db.studyGuide.update({ where: { id: guide.id }, data: { status } });
  await ctx.log(
    totals.dropped || lowConfidence ? "WARN" : "INFO",
    `Validated ${totals.proposed} statements: ${totals.verified} verified, ${totals.dropped} removed, ${lowConfidence} low-confidence section(s)`,
    totals,
  );

  return {
    result: { guideId: guide.id, sections: outline.sections.length, ...totals, lowConfidenceSections: lowConfidence },
    usage,
    model: ctx.model.model,
    provider: ctx.model.provider,
    promptVersion: PROMPT_VERSION,
  };
}

/** REGENERATE_ITEM for one study guide section. Never silently overwrites a user edit. */
export async function regenerateStudyGuideSection(job: GenerationJob, ctx: GenerationContext): Promise<GenerationResult> {
  const payload = job.payload as RegenerateSectionPayload;
  const section = await db.studyGuideSection.findUniqueOrThrow({
    where: { id: payload.sectionId },
    include: { guide: { include: { studySet: true, sections: { orderBy: { order: "asc" } } } }, anchors: true },
  });
  if (section.editedByUser && !payload.force) {
    throw new PipelineError("This section has your edits. Confirm to replace them.");
  }
  const set = section.guide.studySet;
  const index = new PassageIndex(await loadAllChunks(set.id));
  const system = systemPrompt(settingsFor(set, section.guide.style));

  // Rebuild the outline from the stored sections so the model sees the guide's structure.
  const outline: Outline = {
    title: section.guide.title,
    sections: section.guide.sections.map((s, i) => ({
      key: `s${i + 1}`,
      level: s.parentId ? 2 : 1,
      kind: s.kind,
      title: s.title,
      learningObjective: s.learningObjective ?? "",
      sourceRefs: [],
    })),
  };
  const key = `s${section.guide.sections.findIndex((s) => s.id === section.id) + 1}`;
  const previouslyCited = section.anchors.flatMap((a) => (a.chunkId ? [a.chunkId] : []));

  await ctx.progress(0.1, `Regenerating “${section.title}”`);
  const { validated, usage } = await generateSection(ctx, system, outline, key, index, set, previouslyCited, payload.instructions);
  const anchors = await buildAnchors(anchorInputs(validated), { studyGuideSectionId: section.id });
  await db.$transaction(async (tx) => {
    await tx.citationAnchor.deleteMany({ where: { studyGuideSectionId: section.id } });
    const updated = await tx.studyGuideSection.update({
      where: { id: section.id },
      data: {
        content: validated.content,
        claimType: validated.claimType,
        confidence: validated.confidence,
        warnings: validated.warnings,
        rationale: `${validated.stats.verified}/${validated.stats.proposed} statements verified against sources`,
        editedByUser: false,
        version: { increment: 1 },
      },
    });
    if (anchors.length) await tx.citationAnchor.createMany({ data: anchors });
    await writeSectionVersion(tx, section.id, set.id, updated.version, "ai", job.userId);
  });
  await ctx.progress(1, "Section regenerated");
  return {
    result: { sectionId: section.id, ...validated.stats },
    usage,
    model: ctx.model.model,
    provider: ctx.model.provider,
    promptVersion: PROMPT_VERSION,
  };
}

export { writeSectionVersion };
