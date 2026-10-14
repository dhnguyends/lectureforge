/**
 * Re-runs the independent answer check on the newest exercise set and prints
 * the comparison (does not change anything). Diagnostic for the generator.
 *   npx tsx scripts/check-exercise-answers.ts
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { getChatModel } from "../src/server/ai";
import { SOLVER_SYSTEM, solverPrompt } from "../src/server/generation/exercises/prompts";
import { IndependentSolveSchema } from "../src/server/generation/exercises/schemas";
import { answersAgree, type FinalAnswer } from "../src/server/generation/exercises/validate";

async function main() {
  const set = await db.exerciseSet.findFirst({ orderBy: { createdAt: "desc" }, include: { exercises: { orderBy: { order: "asc" } } } });
  if (!set) throw new Error("No exercise set.");
  const numeric = set.exercises
    .map((e) => ({ e, fa: (e.verification as { finalAnswer?: FinalAnswer | null } | null)?.finalAnswer ?? null }))
    .filter((x): x is { e: (typeof set.exercises)[number]; fa: FinalAnswer } => x.fa !== null);
  const model = getChatModel();
  console.log(`${set.title}: ${numeric.length} numeric exercises, model ${model.model}`);
  const res = await model.generateJson({
    system: SOLVER_SYSTEM,
    prompt: solverPrompt(numeric.map(({ e, fa }) => ({ id: `e${e.order}`, statement: e.statement, unit: fa.unit }))),
    schema: IndependentSolveSchema,
    maxTokens: 16_000,
  });
  for (const a of res.data.answers) {
    const x = numeric.find(({ e }) => `e${e.order}` === a.id);
    if (!x) continue;
    const agreed = a.value !== null && answersAgree(x.fa, a.value);
    console.log(`${agreed ? "agree   " : "DISAGREE"} #${x.e.order + 1} key=${x.fa.value} check=${a.value} | ${a.solution.replace(/\s+/g, " ").slice(0, 140)}`);
  }
  console.log(`tokens ${res.usage.inputTokens}/${res.usage.outputTokens}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
