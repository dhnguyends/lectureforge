import { createHash } from "node:crypto";
import type { ChunkKind, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { IngestContext } from "../context";

export type ChunkRow = {
  kind: ChunkKind;
  text: string;
  tokenCount: number;
  startMs?: number;
  endMs?: number;
  pageStart?: number;
  pageEnd?: number;
  regions?: Prisma.InputJsonValue;
  headingPath: string[];
  hasEquation: boolean;
  hasCode: boolean;
  metadata?: Prisma.InputJsonValue;
};

/**
 * Replaces all chunks for the source. Citation anchors that referenced old
 * chunks keep their source/time/page data (chunkId is set null on delete), so
 * re-processing never silently breaks existing citations.
 */
export async function replaceChunks(ctx: IngestContext, rows: ChunkRow[]): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.extractedChunk.deleteMany({ where: { sourceId: ctx.source.id } });
    await tx.extractedChunk.createMany({
      data: rows.map((r, index) => ({
        ...r,
        index,
        studySetId: ctx.studySet.id,
        sourceId: ctx.source.id,
        contentHash: createHash("sha256").update(r.text).digest("hex"),
      })),
    });
  });
  await ctx.log("INFO", `Created ${rows.length} citable chunks`);
}
