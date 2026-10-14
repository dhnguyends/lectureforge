import { z, type ZodType } from "zod";
import { AiError, parseJsonOutput, type ChatModel, type JsonRequest, type JsonResponse } from "./types";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
type Completion = {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * POST /chat/completions with a JSON-schema response format. Works with
 * OpenAI and local servers (Ollama, LM Studio, vLLM). Local models trip the
 * citation validator more often; quality depends heavily on the model.
 */
export class OpenAICompatibleChatModel implements ChatModel {
  readonly provider = "openai-compatible";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
  ) {}

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    const schema = z.toJSONSchema(req.schema as ZodType, { unrepresentable: "any" });
    const messages: ChatMessage[] = [
      { role: "system", content: req.system },
      { role: "user", content: req.prompt },
    ];
    const usage = { inputTokens: 0, outputTokens: 0 };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const body = await this.call(messages, schema, req.maxTokens ?? 16_000);
      usage.inputTokens += body.usage?.prompt_tokens ?? 0;
      usage.outputTokens += body.usage?.completion_tokens ?? 0;
      const choice = body.choices?.[0];
      if (choice?.finish_reason === "length") {
        throw new AiError("The generated content was too long for the model.", false, "finish_reason=length");
      }
      const text = choice?.message?.content ?? "";
      const parsed = parseJsonOutput(text, req.schema as ZodType<T>);
      if (parsed.ok) return { data: parsed.data, usage, model: body.model ?? this.model };
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: `${parsed.error}\n\nReturn the complete corrected JSON object only.` });
    }
    throw new AiError("The AI model returned malformed output twice.", false);
  }

  private async call(messages: ChatMessage[], schema: unknown, maxTokens: number): Promise<Completion> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({
          model: this.model,
          messages,
          max_tokens: maxTokens,
          response_format: { type: "json_schema", json_schema: { name: "output", schema, strict: false } },
        }),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch (err) {
      throw new AiError("Could not reach the AI provider. We will retry automatically.", true, String(err));
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      const retryable = res.status === 429 || res.status >= 500;
      throw new AiError(retryable ? "The AI provider is busy. We will retry automatically." : "The AI request was rejected.", retryable, `HTTP ${res.status}: ${text}`);
    }
    return (await res.json()) as Completion;
  }
}
