import { chunkTranscript, type TranscriptSegmentInput } from "@/lib/chunking/transcript";
import { db } from "@/lib/db";
import { mergeTranscriptParts, type NormalizedSegment } from "@/lib/transcript";
import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { formatClock, formatDuration } from "@/lib/time";
import type { TranscribedSegment, TranscriptionProvider } from "@/server/providers/transcription";
import { transcriptionGate } from "@/server/providers/transcription/gate";
import type { IngestContext } from "../context";
import { PipelineError } from "../errors";
import { replaceChunks } from "./persist";
import type { AudioPart } from "./media";

type Checkpoint = { modelKey: string; language: string | null; parts: Record<string, TranscribedSegment[]> };

/** Course vocabulary passed as a recognition hint. */
function vocabularyPrompt(ctx: IngestContext): string {
  return [ctx.studySet.title, ctx.studySet.course, ctx.studySet.subject, ctx.source.title]
    .filter(Boolean)
    .join(", ");
}

export async function transcribe(
  ctx: IngestContext,
  provider: TranscriptionProvider,
  parts: AudioPart[],
  durationMs: number,
): Promise<NormalizedSegment[]> {
  const diarize = ctx.studySet.speakerDiarization && provider.supportsDiarization;
  if (ctx.studySet.speakerDiarization && !provider.supportsDiarization) {
    await ctx.log("WARN", `Speaker labels are not available with the ${provider.name} transcription provider.`);
  }

  // Finished parts are checkpointed on the job, so a retry (crash, timeout,
  // worker restart) resumes where it stopped instead of starting over.
  const e = env();
  const modelKey = `${provider.name}:${e.TRANSCRIPTION_PROVIDER === "deepgram" ? e.DEEPGRAM_MODEL : e.TRANSCRIPTION_MODEL}`;
  const stored = (await db.generationJob.findUnique({ where: { id: ctx.job.id }, select: { result: true } }))?.result as { transcription?: Checkpoint } | null;
  const checkpoint: Checkpoint =
    stored?.transcription?.modelKey === modelKey ? stored.transcription : { modelKey, language: null, parts: {} };
  const keyOf = (p: AudioPart) => `${p.startMs}-${p.endMs}`;
  const resumed = parts.filter((p) => checkpoint.parts[keyOf(p)]).length;
  if (resumed) await ctx.log("INFO", `Resuming: ${resumed} of ${parts.length} parts were already transcribed`);

  const gate = transcriptionGate(e.TRANSCRIPTION_CONCURRENCY);
  let language: string | null = ctx.studySet.transcriptLanguage ?? checkpoint.language;
  let model = "";
  const started = Date.now();
  for (const [i, part] of parts.entries()) {
    const key = keyOf(part);
    if (!checkpoint.parts[key]) {
      if (gate.busy) await ctx.log("INFO", "Waiting for the speech-to-text service (another recording is being transcribed)");
      const r = await gate.run(() =>
        provider.transcribe({
          filePath: part.path,
          mimeType: "audio/mpeg",
          // Once detected on the first part, the language is fixed for the rest:
          // faster, and avoids a part being mis-detected as another language.
          language,
          diarize,
          prompt: vocabularyPrompt(ctx),
        }),
      );
      language ??= r.language;
      model = r.model;
      checkpoint.parts[key] = r.segments;
      checkpoint.language = language;
      await db.generationJob.update({ where: { id: ctx.job.id }, data: { result: { transcription: checkpoint } as unknown as Prisma.InputJsonValue } });
    }
    if (parts.length > 1) {
      const done = i + 1;
      const elapsed = (Date.now() - started) / 1000;
      const remaining = done < parts.length && elapsed > 5 ? ` · about ${formatDuration((elapsed / done) * (parts.length - done))} left` : "";
      await ctx.log("INFO", `Transcribed part ${done} of ${parts.length} (${formatClock(part.startMs)}–${formatClock(part.endMs)})${remaining}`);
    }
    await ctx.progress((i + 1) / parts.length);
  }
  model ||= modelKey.split(":").slice(1).join(":");
  const results = parts.map((p) => ({ startMs: p.startMs, segments: checkpoint.parts[keyOf(p)]! }));

  const segments = mergeTranscriptParts(results, durationMs);
  if (segments.length === 0) {
    throw new PipelineError("No speech was detected in this recording.");
  }

  // Replace any transcript from a previous attempt (retries are idempotent).
  await db.$transaction(async (tx) => {
    await tx.transcript.deleteMany({ where: { sourceId: ctx.source.id } });
    await tx.transcript.create({
      data: {
        sourceId: ctx.source.id,
        language,
        provider: provider.name,
        model,
        diarized: diarize,
        segments: {
          createMany: {
            data: segments.map((s) => ({
              index: s.index,
              startMs: s.startMs,
              endMs: s.endMs,
              speaker: s.speaker,
              text: s.text,
              originalText: s.text,
              confidence: s.confidence,
            })),
          },
        },
      },
    });
    await tx.source.update({ where: { id: ctx.source.id }, data: { language } });
  });
  // The checkpoint has served its purpose once the transcript is stored.
  await db.generationJob.update({ where: { id: ctx.job.id }, data: { result: Prisma.DbNull } });
  await ctx.log("INFO", `Transcribed ${segments.length} segments`, { language, model });
  return segments;
}

export async function segmentTranscript(ctx: IngestContext, segments: TranscriptSegmentInput[]): Promise<number> {
  const chunks = chunkTranscript(segments);
  await replaceChunks(
    ctx,
    chunks.map((c) => ({
      kind: "TRANSCRIPT" as const,
      text: c.text,
      tokenCount: c.tokenCount,
      startMs: c.startMs,
      endMs: c.endMs,
      headingPath: [],
      hasEquation: false,
      hasCode: false,
      metadata: { firstSegment: c.firstSegment, lastSegment: c.lastSegment, speakers: c.speakers },
    })),
  );
  return chunks.length;
}
