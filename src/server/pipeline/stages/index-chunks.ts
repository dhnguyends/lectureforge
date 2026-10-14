import { db } from "@/lib/db";
import { getEmbeddingProvider } from "@/server/providers/embeddings";
import type { IngestContext } from "../context";

const BATCH = 64;

/**
 * Embeds this source's chunks into pgvector. When embeddings are disabled the
 * source is still usable through lexical (full-text) search; we log a warning
 * rather than failing.
 */
export async function indexChunks(ctx: IngestContext): Promise<void> {
  const provider = getEmbeddingProvider();
  if (!provider) {
    await ctx.log("WARN", "Semantic search is not configured; this source is searchable by keywords only.");
    return;
  }
  const chunks = await db.extractedChunk.findMany({
    where: { sourceId: ctx.source.id },
    orderBy: { index: "asc" },
    select: { id: true, text: true, headingPath: true },
  });
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH);
    // Prefixing the heading path gives short chunks the context they need.
    const inputs = batch.map((c) => (c.headingPath.length ? `${c.headingPath.join(" › ")}\n\n${c.text}` : c.text));
    const vectors = await provider.embed(inputs, "document");
    await db.$transaction(
      batch.map((c, j) =>
        db.$executeRaw`UPDATE "ExtractedChunk"
          SET embedding = ${JSON.stringify(vectors[j])}::vector, "embeddingModel" = ${provider.model}
          WHERE id = ${c.id}::uuid`,
      ),
    );
    await ctx.progress(Math.min(1, (i + batch.length) / chunks.length));
  }
  await ctx.log("INFO", `Indexed ${chunks.length} chunks`, { model: provider.model });
}
