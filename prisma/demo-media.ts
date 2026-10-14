/**
 * Demo media for the seeded study set, generated locally:
 *  - a placeholder video (title card + running clock, silent) so the player,
 *    captions and transcript sync can be exercised without a real lecture;
 *  - a slide deck PDF rendered from the seeded slide text, so the slide viewer
 *    and region highlighting work on a real PDF parsed by the real pipeline.
 * Both are clearly labelled as demo material.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

const require = createRequire(import.meta.url);
const FONT_DIR = join(dirname(require.resolve("dejavu-fonts-ttf/package.json")), "ttf");
export const DEMO_FONT = join(FONT_DIR, "DejaVuSans.ttf");
const DEMO_FONT_BOLD = join(FONT_DIR, "DejaVuSans-Bold.ttf");

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(process.env.FFMPEG_PATH ?? "ffmpeg", args, { windowsHide: true });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err}`))));
  });
}

/** Escapes a path for use inside an ffmpeg filter argument (Windows drive colons, quotes). */
function filterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export async function makePlaceholderVideo(outPath: string, durationSec: number): Promise<void> {
  const font = filterPath(DEMO_FONT);
  const text = (t: string, y: string, size: number, color = "white") =>
    `drawtext=fontfile='${font}':text='${t}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
  const vf = [
    text("LectureForge demo", "h*0.30", 54),
    text("Placeholder video - no lecture audio", "h*0.30+80", 30, "0xc8d3da"),
    text("The transcript beside it is seeded demo text", "h*0.30+125", 26, "0x9fb0bb"),
    `drawtext=fontfile='${font}':text='%{pts\\:hms}':fontcolor=0x7fd1c7:fontsize=64:x=(w-text_w)/2:y=h*0.62`,
  ].join(",");
  await ffmpeg([
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `color=c=0x1d2a33:s=1280x720:r=10:d=${durationSec}`,
    "-f", "lavfi", "-i", `anullsrc=channel_layout=mono:sample_rate=16000`,
    "-vf", vf,
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-crf", "32", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "32k",
    "-t", String(durationSec), "-movflags", "+faststart",
    outPath,
  ]);
}

export type SlideSpec = { title: string; lines: string[] };

function wrap(text: string, width: (t: string) => number, max: number): string[] {
  if (width(text) <= max) return [text];
  const out: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && width(next) > max) {
      out.push(current);
      current = word;
    } else current = next;
  }
  if (current) out.push(current);
  return out;
}

/** 16:9 slide deck. Each line is drawn as one text run so extraction keeps it intact. */
export async function makeSlidesPdf(outPath: string, slides: SlideSpec[]): Promise<void> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle("Lecture 7 slides (LectureForge demo)");
  const regular = await pdf.embedFont(await readFile(DEMO_FONT), { subset: true });
  const bold = await pdf.embedFont(await readFile(DEMO_FONT_BOLD), { subset: true });
  const W = 960;
  const H = 540;
  for (const [i, slide] of slides.entries()) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 6, width: W, height: 6, color: rgb(0.16, 0.37, 0.4) });
    let y = H - 90;
    for (const part of wrap(slide.title, (t) => bold.widthOfTextAtSize(t, 34), W - 120)) {
      page.drawText(part, { x: 60, y, size: 34, font: bold, color: rgb(0.1, 0.13, 0.17) });
      y -= 44;
    }
    y -= 26;
    for (const line of slide.lines) {
      if (line === "") {
        y -= 22;
        continue;
      }
      const mono = line.startsWith("    ") || /^(def |\s*return )/.test(line);
      const x = mono ? 80 : 60;
      const size = mono ? 20 : 24;
      // pdf-lib does not wrap: break long lines at word boundaries to fit the slide.
      for (const part of wrap(line, (t) => regular.widthOfTextAtSize(t, size), W - x - 60)) {
        page.drawText(part, { x, y, size, font: regular, color: rgb(0.15, 0.18, 0.22) });
        y -= mono ? 30 : 34;
      }
      y -= mono ? 0 : 6;
    }
    page.drawText(`Lecture 7 · slide ${i + 1} · LectureForge demo`, { x: 60, y: 24, size: 11, font: regular, color: rgb(0.5, 0.55, 0.6) });
  }
  await writeFile(outPath, await pdf.save());
}
