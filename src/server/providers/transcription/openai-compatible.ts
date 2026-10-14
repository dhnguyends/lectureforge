import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { Agent, FormData, fetch } from "undici";
import { PipelineError, providerError } from "@/server/pipeline/errors";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./types";

type VerboseJson = {
  language?: string;
  segments?: { start: number; end: number; text: string; avg_logprob?: number; speaker?: string }[];
  text?: string;
};

/**
 * Any server implementing POST /audio/transcriptions with
 * response_format=verbose_json: OpenAI Whisper, Groq, speaches /
 * faster-whisper-server, whisper.cpp server, LocalAI, etc.
 *
 * Uses its own HTTP agent: Node's global fetch gives up after 5 minutes without
 * response headers, but a transcription server only answers once a part is done.
 */
export class OpenAICompatibleTranscription implements TranscriptionProvider {
  readonly name = "openai-compatible";
  // OpenAI caps uploads at 25 MB; local servers accept far more (TRANSCRIPTION_MAX_MB).
  readonly maxBytes: number;
  readonly supportsDiarization = false;
  private readonly agent: Agent;

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    maxMegabytes = 24,
    private readonly timeoutMs = 30 * 60 * 1000,
  ) {
    this.maxBytes = Math.floor(maxMegabytes * 1024 * 1024);
    this.agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs, connectTimeout: 15_000 });
  }

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    const form = new FormData();
    form.set("file", await openAsBlob(req.filePath, { type: req.mimeType }), basename(req.filePath));
    form.set("model", this.model);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (req.language) form.set("language", req.language.split("-")[0]!);
    if (req.prompt) form.set("prompt", req.prompt.slice(0, 800));

    let res: Awaited<ReturnType<typeof fetch>>;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/audio/transcriptions`, {
        method: "POST",
        headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
        body: form,
        dispatcher: this.agent,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const cause = (err as { cause?: { code?: string } }).cause?.code ?? (err as Error).name;
      const unreachable = cause === "ECONNREFUSED" || cause === "UND_ERR_CONNECT_TIMEOUT" || cause === "ENOTFOUND";
      throw new PipelineError(
        unreachable
          ? "The speech-to-text service is not reachable. We will retry automatically."
          : "The speech-to-text service did not finish in time. We will retry automatically.",
        { retryable: true, cause: err, detail: `transcription request to ${this.baseUrl} failed: ${cause}` },
      );
    }
    if (!res.ok) {
      const text = await res.text();
      if (/not installed locally/i.test(text)) {
        throw new PipelineError("The speech-to-text model is not installed on this server yet.", {
          detail: `${this.model} missing in the STT service; run npm run models:init. ${text.slice(0, 200)}`,
        });
      }
      throw providerError("transcription", res.status, text);
    }
    const body = (await res.json()) as VerboseJson;
    if (!body.segments) {
      throw new PipelineError("The transcription service returned no timestamps.", {
        detail: `Model ${this.model} did not return verbose_json segments; use a Whisper-family model.`,
      });
    }
    return {
      language: body.language ?? req.language,
      model: this.model,
      segments: body.segments.map((s) => ({
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        text: s.text.trim(),
        speaker: s.speaker ?? null,
        confidence: s.avg_logprob === undefined ? null : Math.min(1, Math.exp(s.avg_logprob)),
      })),
    };
  }
}
