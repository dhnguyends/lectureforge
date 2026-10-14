import { env } from "@/lib/env";
import { ollamaChatStream, type OllamaMessage } from "@/server/ai/ollama";

export type TutorStreamEvent = { delta: string } | { done: true; inputTokens: number; outputTokens: number };

/** The chat model behind the tutor. Injectable so the tutor can be tested without a model server. */
export interface TutorModel {
  readonly provider: string;
  readonly model: string;
  stream(messages: OllamaMessage[], signal?: AbortSignal): AsyncGenerator<TutorStreamEvent>;
}

/** Gemma 4 (or any chat model) on the local Ollama server. */
export class OllamaTutorModel implements TutorModel {
  readonly provider = "ollama";
  constructor(
    readonly model: string,
    private readonly think: boolean,
    private readonly numCtx: number,
  ) {}
  stream(messages: OllamaMessage[], signal?: AbortSignal) {
    return ollamaChatStream({ model: this.model, messages, think: this.think, numCtx: this.numCtx, signal });
  }
}

export function getTutorModel(): TutorModel {
  const e = env();
  return new OllamaTutorModel(e.TUTOR_MODEL, e.TUTOR_THINK, e.TUTOR_NUM_CTX);
}
