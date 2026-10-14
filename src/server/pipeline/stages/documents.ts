import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { getDocumentProxy } from "unpdf";
import { chunkDocument, stripRunningHeadersFooters, textToPage, type BBox, type DocumentPage, type PageLine } from "@/lib/chunking/document";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { keys, uploadFile } from "@/lib/storage";
import { getOcrProvider } from "@/server/providers/ocr";
import { Gate } from "@/server/providers/transcription/gate";
import type { IngestContext } from "../context";
import { PipelineError } from "../errors";
import { run } from "../exec";
import { replaceChunks } from "./persist";

type TextItem = { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean };

/** A page with fewer characters than this is treated as scanned (needs OCR). */
const MIN_TEXT_CHARS = 25;

/**
 * Extracts text lines with normalised bounding boxes from every page, so
 * citations can point at a region, not just a page number.
 */
export async function parsePdf(ctx: IngestContext, path: string): Promise<DocumentPage[]> {
  const data = new Uint8Array(await readFile(path));
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(data);
  } catch (err) {
    const encrypted = String(err).toLowerCase().includes("password");
    throw new PipelineError(
      encrypted ? "This PDF is password-protected. Remove the password and upload it again." : "We could not read this PDF.",
      { cause: err, detail: String(err) },
    );
  }

  const pages: DocumentPage[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [vx0, vy0, vx1, vy1] = page.view as [number, number, number, number];
    const w = vx1 - vx0;
    const h = vy1 - vy0;
    const content = await page.getTextContent();
    const lines: PageLine[] = [];
    let text = "";
    let box: BBox | null = null;
    let lastY: number | null = null;
    let lastBottom: number | null = null;
    let lastHeight = 0;

    const endLine = () => {
      if (text.trim()) {
        // Blank line on a large vertical gap marks a paragraph break.
        if (lastBottom !== null && box && box[1] - lastBottom > 0.8 * (lastHeight / h)) lines.push({ text: "" });
        lines.push({ text: text.replace(/\s+$/, ""), bbox: box ?? undefined });
        lastBottom = box?.[3] ?? lastBottom;
      }
      text = "";
      box = null;
    };

    for (const raw of content.items) {
      if (!("str" in raw)) continue;
      const item = raw as TextItem;
      const x = item.transform[4]! - vx0;
      const y = item.transform[5]! - vy0;
      const height = item.height || Math.abs(item.transform[3] ?? 0) || 10;
      if (lastY !== null && Math.abs(y - lastY) > height * 0.5) endLine();
      const itemBox: BBox = [x / w, 1 - (y + height) / h, (x + item.width) / w, 1 - y / h];
      box = box
        ? [Math.min(box[0], itemBox[0]), Math.min(box[1], itemBox[1]), Math.max(box[2], itemBox[2]), Math.max(box[3], itemBox[3])]
        : itemBox;
      text += item.str;
      lastY = y;
      lastHeight = height;
      if (item.hasEOL) {
        endLine();
        lastY = null;
      }
    }
    endLine();
    pages.push({ page: n, lines: lines.map((l) => ({ ...l, bbox: l.bbox?.map(clamp01) as BBox | undefined })) });
    await ctx.progress(n / pdf.numPages);
  }
  await db.source.update({ where: { id: ctx.source.id }, data: { pageCount: pdf.numPages } });
  return pages;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number(v.toFixed(4))));

export function pagesNeedingOcr(pages: DocumentPage[]): number[] {
  return pages.filter((p) => p.lines.map((l) => l.text).join("").trim().length < MIN_TEXT_CHARS).map((p) => p.page);
}

/** Renders scanned pages to images and OCRs them in place. */
export async function ocrPdfPages(ctx: IngestContext, pdfPath: string, pages: DocumentPage[]): Promise<DocumentPage[]> {
  const targets = pagesNeedingOcr(pages);
  if (targets.length === 0) return pages;
  const ocr = await getOcrProvider();
  if (!ocr) {
    await ctx.log("WARN", `${targets.length} page(s) have no extractable text and OCR is disabled; they will not be searchable.`, {
      pages: targets,
    });
    return pages;
  }
  const result = new Map(pages.map((p) => [p.page, p]));
  for (const [i, n] of targets.entries()) {
    const prefix = join(ctx.workDir, `page-${n}`);
    await run(env().PDFTOPPM_PATH, ["-r", "200", "-png", "-singlefile", "-f", String(n), "-l", String(n), pdfPath, prefix]);
    const { lines, engine } = await ocr.recognize(`${prefix}.png`, ctx.studySet.transcriptLanguage ?? ctx.studySet.language);
    result.set(n, { page: n, lines });
    if (i === 0) await ctx.log("INFO", `Text recognition engine: ${engine}`);
    await ctx.progress((i + 1) / targets.length);
  }
  await ctx.log("INFO", `Recognised text on ${targets.length} scanned page(s)`);
  return [...result.values()].sort((a, b) => a.page - b.page);
}

/**
 * LibreOffice allows one running instance per user profile, and building a
 * fresh profile costs about a minute. Conversions therefore share one
 * persistent profile and run one at a time in this worker.
 */
const officeGate = new Gate(1);

function officeProfileUrl(): string {
  const root = env().WORKER_TMP_DIR ?? join(tmpdir(), "lectureforge");
  return `file:///${join(root, "libreoffice-profile").replace(/\\/g, "/").replace(/^\/+/, "")}`;
}

/**
 * Word / OpenDocument / RTF / PowerPoint → PDF via headless LibreOffice. The
 * PDF is kept as the source's viewable form, so citations point at its pages.
 */
export async function convertToPdf(ctx: IngestContext, inputPath: string): Promise<string> {
  const outDir = join(ctx.workDir, "converted");
  await mkdir(outDir, { recursive: true });
  // A plain ASCII name avoids LibreOffice quirks with unusual characters and makes the output name predictable.
  const input = join(ctx.workDir, `convert-input${extname(inputPath).toLowerCase()}`);
  await copyFile(inputPath, input);
  const pdfPath = join(outDir, "convert-input.pdf");

  if (officeGate.busy) await ctx.log("INFO", "Waiting for another document conversion to finish");
  const started = Date.now();
  await officeGate.run(() =>
    run(
      env().SOFFICE_PATH,
      ["--headless", "--norestore", "--nolockcheck", "--nologo", `-env:UserInstallation=${officeProfileUrl()}`, "--convert-to", "pdf", "--outdir", outDir, input],
      { timeoutMs: 10 * 60 * 1000 },
    ),
  );
  // soffice exits 0 even when it cannot open the file; the missing output is the only signal.
  const size = await stat(pdfPath).then((st) => st.size, () => 0);
  if (size === 0) {
    throw new PipelineError("We could not convert this file to PDF. It may be damaged or password-protected.", {
      detail: `LibreOffice produced no PDF for ${extname(inputPath)}`,
    });
  }
  await ctx.log("INFO", `Converted to PDF in ${((Date.now() - started) / 1000).toFixed(1)} s`);

  const key = keys.derived(ctx.storagePrefix, ctx.source.kind === "SLIDES" ? "slides.pdf" : "document.pdf");
  await uploadFile(key, pdfPath, "application/pdf");
  await db.sourceAsset.upsert({
    where: { storageKey: key },
    create: { sourceId: ctx.source.id, role: "NORMALIZED_PDF", storageKey: key, mimeType: "application/pdf", sizeBytes: BigInt(size) },
    update: { sizeBytes: BigInt(size) },
  });
  return pdfPath;
}

export async function ocrImage(ctx: IngestContext, imagePath: string): Promise<DocumentPage[]> {
  const ocr = await getOcrProvider();
  if (!ocr) {
    throw new PipelineError("Text recognition for images is not enabled on this server.", {
      detail: "OCR_PROVIDER=none",
    });
  }
  const { lines, confidence, engine } = await ocr.recognize(imagePath, ctx.studySet.transcriptLanguage ?? ctx.studySet.language);
  if (!lines.some((l) => l.text.trim())) throw new PipelineError("No readable text was found in this image.");
  await ctx.log("INFO", `Recognised ${lines.filter((l) => l.text.trim()).length} lines with ${engine}`, { confidence });
  if (engine.startsWith("vision:")) {
    await ctx.log("WARN", "Text was transcribed by an AI vision model; check citations from this image against the image itself.");
  }
  return [{ page: 1, lines }];
}

export async function readNote(path: string): Promise<DocumentPage[]> {
  const text = await readFile(path, "utf8");
  if (!text.trim()) throw new PipelineError("This note is empty.");
  return [textToPage(text)];
}

export async function segmentDocument(ctx: IngestContext, pages: DocumentPage[], kind: "PAGE_TEXT" | "OCR" | "NOTE_TEXT"): Promise<number> {
  const chunks = chunkDocument(stripRunningHeadersFooters(pages));
  if (chunks.length === 0) {
    throw new PipelineError("No text could be extracted from this file.");
  }
  await replaceChunks(
    ctx,
    chunks.map((c) => ({
      kind,
      text: c.text,
      tokenCount: c.tokenCount,
      pageStart: c.page,
      pageEnd: c.page,
      regions: c.bbox
        ? [{ page: c.page, bbox: c.bbox }]
        : c.lineStart !== undefined
          ? [{ page: c.page, lineStart: c.lineStart, lineEnd: c.lineEnd ?? c.lineStart }]
          : undefined,
      headingPath: c.headingPath,
      hasEquation: c.hasEquation,
      hasCode: c.hasCode,
      metadata: c.lineBoxes ? { lines: c.lineBoxes } : undefined,
    })),
  );
  return chunks.length;
}
