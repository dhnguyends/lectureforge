import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ZodType } from "zod";
import { logger } from "@/lib/logger";
import { AiError, parseJsonOutput, type ChatModel, type JsonRequest, type JsonResponse } from "./types";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Claude via the official SDK, with structured outputs (JSON schema derived
 * from the Zod schema) and streaming so long generations do not hit HTTP
 * timeouts. Output is still re-validated with the full Zod schema because
 * structured outputs cannot express every constraint (lengths, refinements).
 */
export class AnthropicChatModel implements ChatModel {
  readonly provider = "anthropic";
  private readonly client: Anthropic;

  constructor(
    readonly model: string,
    private readonly effort: Effort,
    private readonly refusalFallback: boolean,
    apiKey: string,
    baseURL: string,
  ) {
    // Credentials are explicit. Passing authToken: null and a baseURL stops the
    // SDK from silently adopting ambient ANTHROPIC_AUTH_TOKEN / ANTHROPIC_BASE_URL
    // values (e.g. those of a developer tool that launched this process).
    this.client = new Anthropic({ apiKey, authToken: null, baseURL });
  }

  async generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>> {
    const format = zodOutputFormat(req.schema as unknown as Parameters<typeof zodOutputFormat>[0]);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: req.prompt }];
    const usage = { inputTokens: 0, outputTokens: 0 };

    // One corrective round: the validation error goes back to the model.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const message = await this.call(req, messages, format.schema as Record<string, unknown>);
      usage.inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
      usage.outputTokens += message.usage.output_tokens;

      if (message.stop_reason === "refusal") {
        throw new AiError(
          "The AI model declined to generate this content.",
          false,
          `refusal: ${message.stop_details?.category ?? "unknown"} ${message.stop_details?.explanation ?? ""}`,
        );
      }
      if (message.stop_reason === "max_tokens") {
        throw new AiError("The generated content was too long. Try a more concise style.", false, "stop_reason=max_tokens");
      }

      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      const parsed = parseJsonOutput(text, req.schema as ZodType<T>);
      if (parsed.ok) return { data: parsed.data, usage, model: message.model };

      logger.warn({ attempt, error: parsed.error.slice(0, 500) }, "model output failed validation");
      // Append-only history: the full assistant turn (including any thinking
      // blocks) goes back unchanged, then the correction request.
      messages.push({ role: "assistant", content: message.content });
      messages.push({
        role: "user",
        content: `${parsed.error}\n\nReturn the complete corrected JSON object only.`,
      });
    }
    throw new AiError("The AI model returned malformed output twice.", false);
  }

  private async call(req: JsonRequest<unknown>, messages: Anthropic.Beta.BetaMessageParam[], schema: Record<string, unknown>) {
    try {
      const stream = this.client.beta.messages.stream({
        model: this.model,
        max_tokens: req.maxTokens ?? 32_000,
        // The system prompt is identical across every section of a guide, so cache it.
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages,
        output_config: { effort: this.effort, format: { type: "json_schema", schema } },
        ...(this.refusalFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      return await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        throw new AiError("The AI provider rejected our credentials. Check ANTHROPIC_API_KEY.", false, err.message);
      }
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
        throw new AiError("The AI request was invalid.", false, err.message);
      }
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
        throw new AiError("The AI provider is busy. We will retry automatically.", true, err.message);
      }
      if (err instanceof Anthropic.APIConnectionError) {
        throw new AiError("Could not reach the AI provider. We will retry automatically.", true, err.message);
      }
      if (err instanceof Anthropic.APIError) {
        throw new AiError("The AI provider returned an error.", (err.status ?? 500) >= 500, err.message);
      }
      throw err;
    }
  }
}
