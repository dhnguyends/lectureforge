-- Local embeddings (EmbeddingGemma, 768 dimensions) replace the 1536-dim column.
-- Existing vectors cannot be converted; they are cleared and rebuilt by REINDEX_SOURCE jobs.
DROP INDEX IF EXISTS "ExtractedChunk_embedding_hnsw_idx";
ALTER TABLE "ExtractedChunk" DROP COLUMN "embedding";
ALTER TABLE "ExtractedChunk" ADD COLUMN "embedding" vector(768);
UPDATE "ExtractedChunk" SET "embeddingModel" = NULL;
CREATE INDEX "ExtractedChunk_embedding_hnsw_idx"
  ON "ExtractedChunk" USING hnsw ("embedding" vector_cosine_ops);

-- Rebuild a source's chunks/embeddings after transcript corrections.
ALTER TYPE "JobType" ADD VALUE 'REINDEX_SOURCE';
