import { env } from "@/lib/env";
import { PipelineError, providerError } from "@/server/pipeline/errors";

/** Retrieval models embed questions and passages differently (asymmetric search). */
export type EmbeddingPurpose = "query" | "document";

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]>;
}

/**
 * POST /embeddings — Ollama (default: EmbeddingGemma), OpenAI, vLLM, LM Studio.
 * Optional prefixes implement each model's task prompts, e.g. EmbeddingGemma's
 * "task: search result | query: " and "title: none | text: ".
 */
export class OpenAICompatibleEmbeddings implements EmbeddingProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    readonly model: string,
    readonly dimensions: number,
    private readonly sendDimensions: boolean,
    private readonly prefixes: { query: string; document: string } = { query: "", document: "" },
  ) {}

  async embed(texts: string[], purpose: EmbeddingPurpose): Promise<number[][]> {
    const prefix = this.prefixes[purpose];
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          input: texts.map((t) => prefix + t),
          ...(this.sendDimensions ? { dimensions: this.dimensions } : {}),
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new PipelineError("The search indexing service is unreachable. We will retry automatically.", {
        retryable: true,
        cause: err,
        detail: `embeddings at ${this.baseUrl}: ${String(err)}`,
      });
    }
    if (!res.ok) throw providerError("embedding", res.status, await res.text());
    const body = (await res.json()) as { data: { index: number; embedding: number[] }[] };
    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    const bad = vectors.find((v) => v.length !== this.dimensions);
    if (bad) {
      throw new PipelineError("Search indexing is misconfigured on this server.", {
        detail: `Embedding model ${this.model} returned ${bad.length} dimensions; database expects ${this.dimensions}.`,
      });
    }
    return vectors;
  }
}

/** Returns null when embeddings are disabled (lexical search still works). */
export function getEmbeddingProvider(): EmbeddingProvider | null {
  const e = env();
  if (e.EMBEDDING_PROVIDER === "none") return null;
  if (e.EMBEDDING_BASE_URL.includes("api.openai.com") && !e.EMBEDDING_API_KEY) return null;
  return new OpenAICompatibleEmbeddings(
    e.EMBEDDING_BASE_URL,
    e.EMBEDDING_API_KEY,
    e.EMBEDDING_MODEL,
    e.EMBEDDING_DIMENSIONS,
    e.EMBEDDING_SEND_DIMENSIONS,
    { query: e.EMBEDDING_QUERY_PREFIX, document: e.EMBEDDING_DOCUMENT_PREFIX },
  );
}
