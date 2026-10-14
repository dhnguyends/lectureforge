/**
 * Retries failed sources, or with --stuck also sources left PROCESSING by a
 * worker that stopped. Only use --stuck while no worker is running.
 *   npm run sources:retry            # failed sources
 *   npm run sources:retry -- --stuck # failed + stuck
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { retrySource } from "../src/server/services/sources";

async function main() {
  const stuck = process.argv.includes("--stuck");
  const sources = await db.source.findMany({
    where: { status: { in: stuck ? ["FAILED", "PROCESSING", "UPLOADED"] : ["FAILED"] }, studySet: { deletedAt: null } },
    select: { id: true, title: true, studySet: { select: { createdById: true } } },
  });
  for (const s of sources) {
    const { jobId } = await retrySource({ id: s.studySet.createdById }, s.id, { includeStuck: stuck });
    console.log(`Requeued "${s.title}" (job ${jobId})`);
  }
  if (!sources.length) console.log("Nothing to retry.");
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
