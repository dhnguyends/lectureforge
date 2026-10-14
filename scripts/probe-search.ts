/**
 * Prints semantic similarity of retrieval results for sample questions, to
 * calibrate relevance thresholds (tutor "not in your sources", search).
 *   npx tsx scripts/probe-search.ts "<study set title prefix>" "question" ...
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { retrieveRanked } from "../src/server/retrieval";

async function main() {
  const [titlePrefix, ...questions] = process.argv.slice(2);
  const set = await db.studySet.findFirstOrThrow({ where: { title: { startsWith: titlePrefix ?? "" }, deletedAt: null }, orderBy: { createdAt: "desc" } });
  for (const q of questions) {
    const r = await retrieveRanked(set.id, q, 3);
    console.log(q.padEnd(70), r.map((c) => `${c.similarity?.toFixed(3) ?? "-"}${c.keywordMatch ? "k" : ""}`).join("  "));
  }
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
