import { estimateTokens } from "./tokens";

/** Normalised bounding box [x0, y0, x1, y1] in 0..1, origin top-left. */
export type BBox = [number, number, number, number];

export type PageLine = { text: string; bbox?: BBox; lineNo?: number };
export type DocumentPage = { page: number; lines: PageLine[] };

export type BlockKind = "heading" | "paragraph" | "code" | "equation" | "list";

export type DocumentChunk = {
  page: number;
  text: string;
  tokenCount: number;
  headingPath: string[];
  bbox?: BBox;
  lineStart?: number;
  lineEnd?: number;
  /** Per-line boxes, so a citation can outline just the lines its excerpt spans. */
  lineBoxes?: { text: string; bbox: BBox }[];
  hasEquation: boolean;
  hasCode: boolean;
};

export type DocumentChunkOptions = { targetTokens: number; maxTokens: number };
export const DEFAULT_DOCUMENT_CHUNKING: DocumentChunkOptions = { targetTokens: 300, maxTokens: 600 };

type Block = { kind: BlockKind; lines: PageLine[]; level?: number };

const MATH_CHARS = /[=∑∫∂∇√±≈≠≤≥∞→←↦∈∉⊂⊆∀∃λμσθαβγδεπφψωΣΠΔΩ^_]/g;
const LATEX = /\\(frac|sum|int|partial|nabla|mathbf|mathcal|alpha|beta|theta|sigma|lambda|begin\{(equation|align)\*?\})|\$\$/;
const CODE_HINT = /^(\s{4,}|\t)|[;{}]\s*$|^\s*(def|class|return|import|from|for|while|if|elif|else|function|const|let|var|public|private|#include)\b/;

export function isEquationLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (LATEX.test(t)) return true;
  if (t.length > 160 || /\.\s+[A-Z]/.test(t)) return false;
  const math = t.match(MATH_CHARS)?.length ?? 0;
  const letters = t.match(/[A-Za-z]/g)?.length ?? 0;
  // Short lines dense with operators/Greek and few words, e.g. "L = −Σ y log ŷ".
  if (math >= 2 && letters / t.length < 0.6) return true;
  // Plain-text notation is letter-heavy ("Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V"):
  // accept an assignment with math syntax when it contains almost no prose words.
  const hasMathSyntax = /[\^_/*]|\b(sqrt|exp|log|ln|softmax|argmax|argmin|sum|max|min|det|tr)\s*\(/.test(t);
  const proseWords = t
    .replace(/\b[A-Za-z_]\w*\s*\(/g, " ") // function names
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]{4,}[,.;:]?$/.test(w)).length;
  return t.includes("=") && hasMathSyntax && proseWords <= 2;
}

export function isCodeLine(text: string): boolean {
  return CODE_HINT.test(text) && !/^\s*[-•*]\s/.test(text);
}

/** Returns heading depth (1-based) or 0 if the line is not a heading. */
export function headingLevel(text: string): number {
  const t = text.trim();
  if (!t || t.length > 90) return 0;
  const md = /^(#{1,6})\s+\S/.exec(t);
  if (md) return md[1]!.length;
  const numbered = /^(\d+(?:\.\d+){0,3})\.?\s+[A-Z][^.!?]*$/.exec(t);
  if (numbered) return numbered[1]!.split(".").length;
  if (/^(chapter|section|lecture|part)\s+\d+/i.test(t) && !/[.!?]$/.test(t)) return 1;
  return 0;
}

function headingText(text: string): string {
  return text.trim().replace(/^#{1,6}\s+/, "");
}

/** Splits a page into typed blocks without altering any text. */
export function toBlocks(lines: PageLine[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let inFence = false;

  const push = () => {
    if (cur && cur.lines.length) blocks.push(cur);
    cur = null;
  };

  for (const line of lines) {
    const t = line.text;
    if (/^\s*```/.test(t)) {
      if (!inFence) {
        push();
        cur = { kind: "code", lines: [line] };
        inFence = true;
      } else {
        cur!.lines.push(line);
        push();
        inFence = false;
      }
      continue;
    }
    if (inFence) {
      cur!.lines.push(line);
      continue;
    }
    if (!t.trim()) {
      push();
      continue;
    }
    const level = headingLevel(t);
    if (level) {
      push();
      blocks.push({ kind: "heading", lines: [line], level });
      continue;
    }
    const kind: BlockKind = isEquationLine(t) ? "equation" : isCodeLine(t) ? "code" : /^\s*([-•*]|\d+[.)])\s/.test(t) ? "list" : "paragraph";
    // Consecutive lines of the same kind stay together; prose lines continue a
    // list item (wrapped text) but code/equations always start a new block.
    const continues =
      cur !== null &&
      ((cur as Block).kind === kind || ((cur as Block).kind === "list" && kind === "paragraph"));
    if (!continues) {
      push();
      cur = { kind, lines: [] };
    }
    cur!.lines.push(line);
  }
  push();
  return blocks;
}

function unionBBox(lines: PageLine[]): BBox | undefined {
  const boxes = lines.map((l) => l.bbox).filter((b): b is BBox => Boolean(b));
  if (!boxes.length) return undefined;
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Packs blocks into chunks that never cross a page (so each chunk cites one
 * page and one region) and never split a code or equation block. Headings
 * start a new chunk and update the heading path carried by later chunks,
 * including across pages.
 */
export function chunkDocument(pages: DocumentPage[], options: Partial<DocumentChunkOptions> = {}): DocumentChunk[] {
  const opts = { ...DEFAULT_DOCUMENT_CHUNKING, ...options };
  const chunks: DocumentChunk[] = [];
  let headingPath: string[] = [];

  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    let lines: PageLine[] = [];
    let kinds = new Set<BlockKind>();
    let tokens = 0;
    let pathForChunk = headingPath;

    const flush = () => {
      const text = lines.map((l) => l.text).join("\n").trim();
      if (text) {
        const nums = lines.map((l) => l.lineNo).filter((n): n is number => n !== undefined);
        chunks.push({
          page: page.page,
          text,
          tokenCount: estimateTokens(text),
          headingPath: pathForChunk,
          bbox: unionBBox(lines),
          lineBoxes: lines.some((l) => l.bbox) ? lines.flatMap((l) => (l.bbox && l.text.trim() ? [{ text: l.text, bbox: l.bbox }] : [])) : undefined,
          lineStart: nums.length ? Math.min(...nums) : undefined,
          lineEnd: nums.length ? Math.max(...nums) : undefined,
          hasEquation: kinds.has("equation"),
          hasCode: kinds.has("code"),
        });
      }
      lines = [];
      kinds = new Set();
      tokens = 0;
      pathForChunk = headingPath;
    };

    for (const block of toBlocks(page.lines)) {
      const blockTokens = estimateTokens(block.lines.map((l) => l.text).join("\n"));

      if (block.kind === "heading") {
        // A heading directly followed by a subheading stays in the same chunk
        // rather than producing a heading-only chunk with nothing to cite.
        if (kinds.size > 0) flush();
        const level = block.level ?? 1;
        headingPath = [...headingPath.slice(0, level - 1), headingText(block.lines[0]!.text)];
        pathForChunk = headingPath;
        // Keep the heading text in the chunk so retrieval sees it.
        lines.push(...block.lines);
        tokens += blockTokens;
        continue;
      }

      const atomic = block.kind === "code" || block.kind === "equation";
      if (tokens > 0 && tokens + blockTokens > opts.maxTokens) flush();
      if (!atomic && blockTokens > opts.maxTokens) {
        // A single oversized paragraph: split on line boundaries.
        for (const line of block.lines) {
          const lt = estimateTokens(line.text);
          if (tokens > 0 && tokens + lt > opts.maxTokens) flush();
          lines.push(line);
          tokens += lt;
          kinds.add(block.kind);
        }
        continue;
      }
      lines.push(...block.lines);
      tokens += blockTokens;
      kinds.add(block.kind);
      if (tokens >= opts.targetTokens) flush();
    }
    flush();
  }
  return chunks;
}

/** Plain-text / Markdown notes become one logical page with line numbers. */
export function textToPage(text: string): DocumentPage {
  return {
    page: 1,
    lines: text.replace(/\r\n?/g, "\n").split("\n").map((t, i) => ({ text: t, lineNo: i + 1 })),
  };
}

/**
 * Removes running headers/footers (course name, "Lecture 7 · slide 3", page
 * numbers): lines near the top or bottom edge whose text, ignoring digits,
 * recurs on most pages. They carry no content and would otherwise become
 * headings or search passages of their own. Needs line boxes and ≥ 3 pages.
 */
export function stripRunningHeadersFooters(pages: DocumentPage[], edge = 0.1, share = 0.6): DocumentPage[] {
  if (pages.length < 3) return pages;
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const nearEdge = (l: PageLine) => l.bbox !== undefined && (l.bbox[1] < edge || l.bbox[3] > 1 - edge);
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const k of new Set(page.lines.filter(nearEdge).map((l) => key(l.text)).filter(Boolean))) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const boilerplate = new Set([...counts].filter(([, n]) => n >= Math.max(3, Math.ceil(pages.length * share))).map(([k]) => k));
  if (!boilerplate.size) return pages;
  return pages.map((p) => ({ ...p, lines: p.lines.filter((l) => !(nearEdge(l) && boilerplate.has(key(l.text)))) }));
}
