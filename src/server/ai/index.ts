import { readAppSettings } from "@/lib/app-settings";
import { env } from "@/lib/env";
import { AnthropicChatModel } from "./anthropic";
import { OpenAICompatibleChatModel } from "./openai-compatible";
import { AiError, type ChatModel } from "./types";

export { AiError, type ChatModel, type JsonRequest, type JsonResponse, type Usage } from "./types";

export function getChatModel(): ChatModel {
  const e = env();
  if (e.AI_PROVIDER === "openai-compatible") {
    return new OpenAICompatibleChatModel(e.OPENAI_COMPAT_BASE_URL, e.OPENAI_COMPAT_API_KEY, e.OPENAI_COMPAT_MODEL);
  }
  if (!e.ANTHROPIC_API_KEY) {
    throw new AiError("AI generation is not configured on this server yet.", false, "ANTHROPIC_API_KEY is not set");
  }
  // Model and effort come from the admin page and apply from the next call on.
  const { aiModel, aiEffort } = readAppSettings();
  return new AnthropicChatModel(aiModel, aiEffort, e.AI_REFUSAL_FALLBACK, e.ANTHROPIC_API_KEY, e.AI_ANTHROPIC_BASE_URL);
}

/** Generation is available only with explicitly configured credentials. */
export function isAiConfigured(): boolean {
  const e = env();
  return e.AI_PROVIDER === "openai-compatible" || Boolean(e.ANTHROPIC_API_KEY);
}
