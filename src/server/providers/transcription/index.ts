import { env } from "@/lib/env";
import { PipelineError } from "@/server/pipeline/errors";
import { DeepgramTranscription } from "./deepgram";
import { OpenAICompatibleTranscription } from "./openai-compatible";
import type { TranscriptionProvider } from "./types";

export type { TranscriptionProvider, TranscriptionResult, TranscribedSegment } from "./types";

const notConfigured = (detail: string) =>
  new PipelineError("Transcription is not configured on this server.", { retryable: false, detail });

export function getTranscriptionProvider(): TranscriptionProvider {
  const e = env();
  if (e.TRANSCRIPTION_PROVIDER === "deepgram") {
    if (!e.DEEPGRAM_API_KEY) throw notConfigured("DEEPGRAM_API_KEY is not set");
    return new DeepgramTranscription(e.DEEPGRAM_API_KEY, e.DEEPGRAM_MODEL);
  }
  const isHostedOpenAI = e.TRANSCRIPTION_BASE_URL.includes("api.openai.com");
  if (isHostedOpenAI && !e.TRANSCRIPTION_API_KEY) throw notConfigured("TRANSCRIPTION_API_KEY is not set");
  return new OpenAICompatibleTranscription(
    e.TRANSCRIPTION_BASE_URL,
    e.TRANSCRIPTION_API_KEY,
    e.TRANSCRIPTION_MODEL,
    e.TRANSCRIPTION_MAX_MB,
    e.TRANSCRIPTION_PART_TIMEOUT_SECONDS * 1000,
  );
}
