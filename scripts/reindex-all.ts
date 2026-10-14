/**
 * Queues a search-index rebuild for every ready source, e.g. after switching
 * embedding models. Requires the worker to be running to process the jobs.
 *   npm run search:reindex
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { scheduleReindex } from "../src/server/pipeline/reindex";

async function main() {
  const sources = await db.source.findMany({
    where: { status: "READY", studySet: { deletedAt: null } },
    select: { id: true, studySetId: true, title: true, studySet: { select: { createdById: true } } },
  });
  let queued = 0;
  for (const s of sources) {
    if (await scheduleReindex(s.id, s.studySetId, s.studySet.createdById, 0)) queued++;
  }
  console.log(`Queued re-indexing for ${queued} of ${sources.length} ready sources.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    process.exit();
  });
