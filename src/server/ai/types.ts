import type { ZodType } from "zod";

export type Usage = { inputTokens: number; outputTokens: number };

export type JsonRequest<T> = {
  /** Stable instructions; identical across calls so the provider can cache them. */
  system: string;
  /** The task, including the source passages for this call. */
  prompt: string;
  /** Validates the model's output. Failures are fed back to the model once. */
  schema: ZodType<T>;
  maxTokens?: number;
};

export type JsonResponse<T> = { data: T; usage: Usage; model: string };

/** One generation backend. Implementations: Anthropic (official SDK), OpenAI-compatible. */
export interface ChatModel {
  readonly provider: string;
  readonly model: string;
  generateJson<T>(req: JsonRequest<T>): Promise<JsonResponse<T>>;
}

/**
 * A model failure. `retryable` separates transient faults (rate limits,
 * overload, network) from ones that will not succeed on retry (declined
 * request, output that never validates, bad configuration).
 */
export class AiError extends Error {
  constructor(
    readonly userMessage: string,
    readonly retryable: boolean,
    detail?: string,
  ) {
    super(detail ?? userMessage);
  }
}

/** Shared validation step: parse JSON text and check it against the schema. */
export function parseJsonOutput<T>(text: string, schema: ZodType<T>): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(stripFences(text));
  } catch (err) {
    return { ok: false, error: `Output is not valid JSON: ${(err as Error).message}` };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 12)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  return { ok: false, error: `Output does not match the required schema:\n${issues}` };
}

function stripFences(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return fenced ? fenced[1]! : t;
}
