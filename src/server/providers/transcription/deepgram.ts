import { openAsBlob } from "node:fs";
import { providerError } from "@/server/pipeline/errors";
import type { TranscriptionProvider, TranscriptionRequest, TranscriptionResult } from "./types";

type DeepgramResponse = {
  metadata?: { model_info?: Record<string, { name?: string }> };
  results?: {
    channels?: { detected_language?: string }[];
    utterances?: { start: number; end: number; transcript: string; speaker?: number; confidence?: number }[];
  };
};

/** Managed speech-to-text with diarization (Deepgram pre-recorded API). */
export class DeepgramTranscription implements TranscriptionProvider {
  readonly name = "deepgram";
  readonly maxBytes = 1.9 * 1024 * 1024 * 1024;
  readonly supportsDiarization = true;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async transcribe(req: TranscriptionRequest): Promise<TranscriptionResult> {
    const params = new URLSearchParams({
      model: this.model,
      smart_format: "true",
      punctuate: "true",
      utterances: "true",
      diarize: String(req.diarize),
    });
    if (req.language) params.set("language", req.language);
    else params.set("detect_language", "true");
    // Keyterm prompting biases recognition toward course vocabulary.
    for (const term of (req.prompt ?? "").split(/[,;\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 50)) {
      params.append("keyterm", term);
    }

    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${this.apiKey}`, "Content-Type": req.mimeType },
      body: await openAsBlob(req.filePath),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!res.ok) throw providerError("Deepgram", res.status, await res.text());
    const body = (await res.json()) as DeepgramResponse;
    const utterances = body.results?.utterances ?? [];
    return {
      language: body.results?.channels?.[0]?.detected_language ?? req.language,
      model: this.model,
      segments: utterances.map((u) => ({
        startMs: Math.round(u.start * 1000),
        endMs: Math.round(u.end * 1000),
        text: u.transcript.trim(),
        speaker: req.diarize && u.speaker !== undefined ? `Speaker ${u.speaker + 1}` : null,
        confidence: u.confidence ?? null,
      })),
    };
  }
}
