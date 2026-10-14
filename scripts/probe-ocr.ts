/** Runs the configured OCR provider on an image: npx tsx scripts/probe-ocr.ts <image> */
import "dotenv/config";
import { getOcrProvider } from "../src/server/providers/ocr";

async function main() {
  const ocr = await getOcrProvider();
  if (!ocr) throw new Error("OCR_PROVIDER=none");
  const t0 = Date.now();
  const r = await ocr.recognize(process.argv[2]!, "en");
  console.log(`${ocr.name} -> engine ${r.engine}, confidence ${r.confidence?.toFixed(1) ?? "n/a"}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const l of r.lines.filter((l) => l.text.trim())) console.log("  |", l.text);
}

main().then(() => process.exit(0), (err) => (console.error(err), process.exit(1)));
