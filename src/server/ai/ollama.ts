import { env } from "@/lib/env";
import { AiError } from "./types";

/**
 * Minimal client for Ollama's native chat API (/api/chat). Used for the tutor
 * (streaming, images) and for vision OCR. Native rather than the OpenAI shim
 * because it exposes `think`, `keep_alive` and per-request context size.
 */
export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
  /** Base64-encoded images (no data: prefix), for vision-capable models. */
  images?: string[];
};

export type OllamaChatRequest = {
  model: string;
  messages: OllamaMessage[];
  think?: boolean;
  numCtx?: number;
  temperature?: number;
  signal?: AbortSignal;
};

type ChatChunk = {
  message?: { content?: string; thinking?: string };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
};

/** Ollama takes a duration ("30m") or a number of seconds (-1 = never unload). */
function keepAlive(value: string): string | number {
  return /^-?\d+$/.test(value.trim()) ? Number(value) : value.trim();
}

function body(req: OllamaChatRequest, stream: boolean) {
  return JSON.stringify({
    model: req.model,
    messages: req.messages,
    stream,
    think: req.think ?? false,
    keep_alive: keepAlive(env().OLLAMA_KEEP_ALIVE),
    options: { num_ctx: req.numCtx ?? 8192, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}) },
  });
}

async function post(req: OllamaChatRequest, stream: boolean): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${env().OLLAMA_BASE_URL.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body(req, stream),
      signal: req.signal ?? AbortSignal.timeout(10 * 60 * 1000),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new AiError("The local AI model is not reachable. Is Ollama running?", true, String(err));
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400);
    const missing = res.status === 404 && /not found/i.test(text);
    throw new AiError(
      missing ? `The model “${req.model}” is not installed in Ollama. Run: ollama pull ${req.model}` : "The local AI model returned an error.",
      res.status >= 500,
      `Ollama HTTP ${res.status}: ${text}`,
    );
  }
  return res;
}

export async function ollamaChat(req: OllamaChatRequest): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
  const res = await post(req, false);
  const chunk = (await res.json()) as ChatChunk;
  if (chunk.error) throw new AiError("The local AI model returned an error.", true, chunk.error);
  return { content: chunk.message?.content ?? "", inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 };
}

/** Streams content deltas (thinking is not forwarded). The last item carries token counts. */
export async function* ollamaChatStream(
  req: OllamaChatRequest,
): AsyncGenerator<{ delta: string } | { done: true; inputTokens: number; outputTokens: number }> {
  const res = await post(req, true);
  if (!res.body) throw new AiError("The local AI model returned no data.", true);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const chunk = JSON.parse(line) as ChatChunk;
      if (chunk.error) throw new AiError("The local AI model returned an error.", true, chunk.error);
      if (chunk.message?.content) yield { delta: chunk.message.content };
      if (chunk.done) {
        yield { done: true, inputTokens: chunk.prompt_eval_count ?? 0, outputTokens: chunk.eval_count ?? 0 };
        return;
      }
    }
  }
}
