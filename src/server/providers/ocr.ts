import { readFile } from "node:fs/promises";
import type { BBox, PageLine } from "@/lib/chunking/document";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ollamaChat } from "@/server/ai/ollama";
import { run } from "@/server/pipeline/exec";

export type OcrResult = {
  lines: PageLine[];
  /** Mean word confidence 0–100, when the engine reports one. */
  confidence: number | null;
  engine: string;
};

export interface OcrProvider {
  readonly name: string;
  recognize(imagePath: string, language: string | null): Promise<OcrResult>;
}

// ISO 639-1 → Tesseract traineddata names for common course languages.
const TESS_LANG: Record<string, string> = { en: "eng", de: "deu", fr: "fra", es: "spa", it: "ita", pt: "por", zh: "chi_sim", ja: "jpn", ko: "kor", vi: "vie" };

/** Parses `tesseract ... tsv` output into lines (level-5 rows are words) and a mean confidence. */
export function parseTesseractTsv(tsv: string): { lines: PageLine[]; confidence: number | null } {
  const rows = tsv.trim().split("\n").slice(1).map((r) => r.split("\t"));
  const page = rows.find((r) => r[0] === "1");
  const pageW = Number(page?.[8] ?? 0);
  const pageH = Number(page?.[9] ?? 0);
  const lines = new Map<string, { words: string[]; box: [number, number, number, number] }>();
  let confSum = 0;
  let confN = 0;
  for (const r of rows) {
    if (r[0] !== "5" || !r[11]?.trim()) continue;
    const key = `${r[2]}-${r[3]}-${r[4]}`; // block-paragraph-line
    const [left, top, width, height] = [r[6], r[7], r[8], r[9]].map(Number) as [number, number, number, number];
    const entry = lines.get(key) ?? { words: [], box: [Infinity, Infinity, 0, 0] };
    entry.words.push(r[11]!.trim());
    entry.box = [Math.min(entry.box[0], left), Math.min(entry.box[1], top), Math.max(entry.box[2], left + width), Math.max(entry.box[3], top + height)];
    lines.set(key, entry);
    const conf = Number(r[10]);
    if (Number.isFinite(conf) && conf >= 0) {
      confSum += conf;
      confN++;
    }
  }
  return {
    lines: [...lines.values()].map(({ words, box }) => ({
      text: words.join(" "),
      bbox: pageW && pageH ? ([box[0] / pageW, box[1] / pageH, box[2] / pageW, box[3] / pageH] as BBox) : undefined,
    })),
    confidence: confN ? confSum / confN : null,
  };
}

class TesseractOcr implements OcrProvider {
  readonly name = "tesseract";
  constructor(
    private readonly bin: string,
    private readonly installed: string[],
  ) {}
  async recognize(imagePath: string, language: string | null): Promise<OcrResult> {
    const wanted = TESS_LANG[(language ?? "en").split("-")[0]!] ?? "eng";
    // Fall back to English when the language pack is not installed.
    const lang = this.installed.includes(wanted) ? wanted : "eng";
    const { stdout } = await run(this.bin, [imagePath, "stdout", "-l", lang, "tsv"], { timeoutMs: 5 * 60 * 1000 });
    return { ...parseTesseractTsv(stdout), engine: `tesseract:${lang}` };
  }
}

/**
 * Transcribes text with a local vision model (Gemma 4 via Ollama). Far better
 * on handwriting and dense math than Tesseract, but returns no per-line
 * boxes, so citations point at the whole image.
 */
export class VisionModelOcr implements OcrProvider {
  readonly name = "ollama-vision";
  constructor(private readonly model: string) {}
  async recognize(imagePath: string): Promise<OcrResult> {
    const image = (await readFile(imagePath)).toString("base64");
    const { content } = await ollamaChat({
      model: this.model,
      temperature: 0,
      numCtx: env().OCR_NUM_CTX,
      messages: [
        {
          role: "system",
          content:
            "You transcribe images of study material (lecture slides, whiteboards, handwritten notes). Output only the text you can see, line by line, in reading order. Write mathematics in LaTeX between $…$. Do not summarise, explain, translate, or add anything that is not visible. Write [illegible] for parts you cannot read.",
        },
        { role: "user", content: "Transcribe this image.", images: [image] },
      ],
    });
    const lines = content
      .replace(/^```[a-z]*\n?|```$/g, "")
      .split("\n")
      .map((t) => ({ text: t.trimEnd() }));
    return { lines, confidence: null, engine: `vision:${this.model}` };
  }
}

/** Tesseract first (precise line boxes); the vision model when Tesseract is unsure. */
class HybridOcr implements OcrProvider {
  readonly name = "hybrid";
  constructor(
    private readonly primary: OcrProvider,
    private readonly fallback: OcrProvider,
    private readonly minConfidence: number,
  ) {}
  async recognize(imagePath: string, language: string | null): Promise<OcrResult> {
    const first = await this.primary.recognize(imagePath, language);
    const chars = first.lines.map((l) => l.text).join("").replace(/\s/g, "").length;
    if (chars >= 20 && (first.confidence ?? 0) >= this.minConfidence) return first;
    logger.info({ confidence: first.confidence, chars }, "low OCR confidence; using vision model");
    try {
      const second = await this.fallback.recognize(imagePath, language);
      return second.lines.some((l) => l.text.trim()) ? second : first;
    } catch (err) {
      logger.warn({ err }, "vision OCR failed; keeping Tesseract result");
      return first;
    }
  }
}

let installedLangs: Promise<string[]> | undefined;
async function tesseractLangs(bin: string): Promise<string[]> {
  installedLangs ??= run(bin, ["--list-langs"], { timeoutMs: 30_000 })
    .then(({ stdout }) => stdout.split(/\r?\n/).slice(1).map((s) => s.trim()).filter(Boolean))
    .catch(() => ["eng"]);
  return installedLangs;
}

export async function getOcrProvider(): Promise<OcrProvider | null> {
  const e = env();
  switch (e.OCR_PROVIDER) {
    case "none":
      return null;
    case "ollama-vision":
      return new VisionModelOcr(e.OCR_VISION_MODEL);
    case "tesseract":
      return new TesseractOcr(e.TESSERACT_PATH, await tesseractLangs(e.TESSERACT_PATH));
    case "hybrid":
      return new HybridOcr(new TesseractOcr(e.TESSERACT_PATH, await tesseractLangs(e.TESSERACT_PATH)), new VisionModelOcr(e.OCR_VISION_MODEL), e.OCR_MIN_CONFIDENCE);
  }
}
