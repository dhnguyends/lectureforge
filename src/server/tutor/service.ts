import type { Prisma, StudySet, TutorMessage } from "@prisma/client";
import type { ConversationSummary, ConversationView, TutorAnchorView, TutorMessageView, TutorStreamEventWire } from "@/lib/contracts/tutor";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { notFound } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createDownloadUrl, keys } from "@/lib/storage";
import type { OllamaMessage } from "@/server/ai/ollama";
import { buildOrTsQuery, retrieveRanked } from "@/server/retrieval";
import { pinpoint, sentencesCiting, type BoxedLine } from "@/lib/citations/verify";
import type { TutorModel } from "./model";
import {
  ACTION_PROMPTS,
  fitTurnToContext,
  resolveRefs,
  stripRefs,
  TUTOR_PROMPT_VERSION,
  tutorSystemPrompt,
  tutorTurn,
  type TurnPassage,
  type TutorAction,
} from "./prompts";

/**
 * Semantic matches below this cosine similarity are not treated as covering the
 * question. Calibrated with EmbeddingGemma (scripts/probe-search.ts): on-topic
 * questions score ~0.44-0.53, unrelated ones <= 0.27.
 */
export const TUTOR_MIN_SIMILARITY = 0.35;
const PASSAGES_PER_TURN = 6;
const HISTORY_MESSAGES = 12;

type StoredImage = { key: string; mimeType: string };

export async function listConversations(studySetId: string, userId: string): Promise<ConversationSummary[]> {
  const rows = await db.tutorConversation.findMany({
    where: { studySetId, userId },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
    take: 100,
  });
  return rows.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.toISOString(), messageCount: c._count.messages }));
}

export async function createConversation(studySetId: string, userId: string, title?: string) {
  return db.tutorConversation.create({ data: { studySetId, userId, title: title || "New conversation" } });
}

/** Conversations are private to the student who started them. */
export async function requireConversation(userId: string, studySetId: string, conversationId: string) {
  const c = await db.tutorConversation.findFirst({ where: { id: conversationId, studySetId, userId } }).catch(() => null);
  if (!c) throw notFound("Conversation");
  return c;
}

async function messageView(m: TutorMessage & { anchors: (Prisma.CitationAnchorGetPayload<{ include: { source: true } }>)[] }): Promise<TutorMessageView> {
  const images = (((m.attachments as { images?: StoredImage[] } | null)?.images ?? []) as StoredImage[]).filter(Boolean);
  return {
    id: m.id,
    role: m.role === "USER" ? "USER" : "ASSISTANT",
    content: m.content,
    action: m.action,
    createdAt: m.createdAt.toISOString(),
    images: await Promise.all(images.map(async (i) => ({ url: await createDownloadUrl(i.key, 3600), mimeType: i.mimeType }))),
    anchors: m.anchors.map(anchorView),
    noSourceMatch: m.warnings.includes("no_source_match") || undefined,
    fromImageOnly: m.warnings.includes("image_only") || undefined,
  };
}

function anchorView(a: Prisma.CitationAnchorGetPayload<{ include: { source: true } }>): TutorAnchorView {
  return {
    id: a.id,
    ref: a.claimKey ?? "",
    sourceId: a.sourceId,
    sourceTitle: a.source.title,
    sourceKind: a.source.kind,
    startMs: a.startMs,
    endMs: a.endMs,
    page: a.page,
    excerpt: a.excerpt,
  };
}

export async function getConversation(conversationId: string, model: string): Promise<ConversationView> {
  const c = await db.tutorConversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "asc" }, include: { anchors: { include: { source: true } } } } },
  });
  return { id: c.id, title: c.title, model, messages: await Promise.all(c.messages.filter((m) => m.role !== "SYSTEM").map(messageView)) };
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await db.tutorConversation.delete({ where: { id: conversationId } });
}

export function imageKey(set: StudySet, conversationId: string, name: string): string {
  return `${keys.studySetPrefix(set.workspaceId, set.id)}tutor/${conversationId}/${name}`;
}

/**
 * One tutor turn: store the question, retrieve passages from the student's
 * sources, stream the model's reply, then keep only citations to passages that
 * were actually offered and store them as anchors on the reply.
 */
export async function answerTurn(input: {
  set: StudySet;
  conversationId: string;
  userId: string;
  text: string;
  action: TutorAction | null;
  image: { base64: string; key: string; mimeType: string } | null;
  model: TutorModel;
  signal?: AbortSignal;
  emit: (event: TutorStreamEventWire) => void;
}): Promise<void> {
  const { set, conversationId, model, emit } = input;
  const question = input.text || (input.action ? ACTION_PROMPTS[input.action] : "");

  const history = await db.tutorConversation.findUniqueOrThrow({
    where: { id: conversationId },
    include: { messages: { orderBy: { createdAt: "desc" }, take: HISTORY_MESSAGES } },
  });
  const previous = history.messages.reverse().filter((m) => m.role !== "SYSTEM");

  const userMessage = await db.tutorMessage.create({
    data: {
      conversationId,
      role: "USER",
      content: question,
      action: input.action,
      warnings: [],
      attachments: input.image ? ({ images: [{ key: input.image.key, mimeType: input.image.mimeType }] } satisfies { images: StoredImage[] }) : undefined,
    },
    include: { anchors: { include: { source: true } } },
  });
  emit({ type: "user", message: await messageView(userMessage) });
  if (previous.length === 0 && input.text) {
    await db.tutorConversation.update({ where: { id: conversationId }, data: { title: input.text.slice(0, 80) } });
  }

  // Follow-ups with little content of their own ("why?", "and then?", action
  // buttons) are searched together with the previous question; anything with
  // its own subject is searched alone so an off-topic question stays off-topic.
  const lastUser = [...previous].reverse().find((m) => m.role === "USER")?.content ?? "";
  const ownTerms = buildOrTsQuery(input.text)?.split(" | ").length ?? 0;
  const searchText = ownTerms >= 2 || !lastUser ? input.text || question : `${lastUser} ${input.text}`.trim();
  const ranked = await retrieveRanked(set.id, searchText, PASSAGES_PER_TURN * 2);
  const hasEmbeddings = ranked.some((c) => c.similarity !== null);
  const system = tutorSystemPrompt(set);
  const fitted = fitTurnToContext({
    numCtx: env().TUTOR_NUM_CTX,
    system,
    question,
    hasImage: Boolean(input.image),
    passages: ranked
      .filter((c) => (hasEmbeddings ? (c.similarity ?? 0) >= TUTOR_MIN_SIMILARITY : c.keywordMatch))
      .slice(0, PASSAGES_PER_TURN),
    passageText: (c) => c.text,
    history: previous.map((m): OllamaMessage => ({ role: m.role === "USER" ? "user" : "assistant", content: stripRefs(m.content) })),
  });
  const passages: TurnPassage[] = fitted.passages.map((chunk, i) => ({ ref: `C${i + 1}`, chunk }));
  const noSourceMatch = passages.length === 0;
  emit({
    type: "sources",
    noSourceMatch: noSourceMatch && !input.image,
    fromImageOnly: noSourceMatch && Boolean(input.image),
    anchors: passages.map((p) => ({
      id: p.chunk.id,
      ref: p.ref,
      sourceId: p.chunk.sourceId,
      sourceTitle: p.chunk.sourceTitle,
      sourceKind: p.chunk.sourceKind,
      startMs: p.chunk.startMs,
      endMs: p.chunk.endMs,
      page: p.chunk.pageStart,
      excerpt: p.chunk.text.slice(0, 280),
    })),
  });

  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    ...fitted.history,
    { role: "user", content: tutorTurn(question, passages, input.action, Boolean(input.image)), ...(input.image ? { images: [input.image.base64] } : {}) },
  ];

  let raw = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  let stopped = false;
  try {
    for await (const event of model.stream(messages, input.signal)) {
      if ("delta" in event) {
        raw += event.delta;
        emit({ type: "delta", text: event.delta });
      } else usage = { inputTokens: event.inputTokens, outputTokens: event.outputTokens };
    }
  } catch (err) {
    if (input.signal?.aborted) stopped = true;
    else throw err;
  }

  const offered = new Set(passages.map((p) => p.ref));
  const { content, used, removed } = resolveRefs(raw.trim(), offered);
  if (removed.length) logger.info({ conversationId, removed }, "tutor cited passages that were not offered; removed");
  const warnings = [noSourceMatch ? (input.image ? "image_only" : "no_source_match") : null, stopped ? "stopped" : null, removed.length ? "removed_invalid_citations" : null].filter(
    (w): w is string => Boolean(w),
  );

  const assistant = await db.tutorMessage.create({
    data: {
      conversationId,
      role: "ASSISTANT",
      content: stopped ? `${content}\n\n*(stopped)*` : content,
      action: input.action,
      warnings,
      provider: model.provider,
      model: `${model.model} · ${TUTOR_PROMPT_VERSION} · in ${usage.inputTokens} / out ${usage.outputTokens}`,
      anchors: {
        create: await Promise.all(passages.filter((p) => used.includes(p.ref)).map((p) => tutorAnchor(p, sentencesCiting(content, p.ref)))),
      },
    },
    include: { anchors: { include: { source: true } } },
  });
  await db.tutorConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  emit({ type: "done", message: await messageView(assistant) });
}

/**
 * Builds the stored citation for a passage the tutor referenced. The tutor
 * cites whole passages ([C2]), so the line it actually drew on is pinpointed
 * from the citing sentence: the transcript line (exact timestamp) or the
 * document line (exact region). Falls back to the whole passage when unclear.
 * These are passage references, not excerpt-verified claims (verified: false).
 */
async function tutorAnchor(p: TurnPassage, statement: string): Promise<Prisma.CitationAnchorCreateWithoutTutorMessageInput> {
  const base = {
    source: { connect: { id: p.chunk.sourceId } },
    chunk: { connect: { id: p.chunk.id } },
    startMs: p.chunk.startMs,
    endMs: p.chunk.endMs,
    page: p.chunk.pageStart,
    excerpt: p.chunk.text.slice(0, 280),
    verified: false,
    claimKey: p.ref,
  };
  const chunk = await db.extractedChunk.findUnique({ where: { id: p.chunk.id }, select: { kind: true, metadata: true } });
  const meta = chunk?.metadata as { firstSegment?: number; lastSegment?: number; lines?: BoxedLine[] } | null;
  if (chunk?.kind === "TRANSCRIPT" && meta?.firstSegment !== undefined && meta.lastSegment !== undefined) {
    const segments = await db.transcriptSegment.findMany({
      where: { transcript: { sourceId: p.chunk.sourceId }, index: { gte: meta.firstSegment, lte: meta.lastSegment }, flaggedInaccurate: false },
      select: { id: true, startMs: true, endMs: true, text: true },
      orderBy: { index: "asc" },
    });
    const hit = pinpoint(statement, segments);
    if (hit) return { ...base, startMs: hit.startMs, endMs: hit.endMs, excerpt: hit.text.slice(0, 500), transcriptSegment: { connect: { id: hit.id } } };
  } else if (meta?.lines?.length) {
    const hit = pinpoint(statement, meta.lines);
    if (hit) return { ...base, excerpt: hit.text.slice(0, 500), region: { page: p.chunk.pageStart, bbox: hit.bbox } };
  }
  return base;
}

export function tutorModelName(): string {
  return env().TUTOR_MODEL;
}
