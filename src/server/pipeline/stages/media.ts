import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseSilences, planCuts } from "@/lib/audio-cuts";
import { env } from "@/lib/env";
import { keys, uploadFile } from "@/lib/storage";
import { db } from "@/lib/db";
import type { IngestContext } from "../context";
import { PipelineError } from "../errors";
import { run } from "../exec";

export type MediaProbe = { durationMs: number; hasAudio: boolean; hasVideo: boolean };

export async function probeMedia(path: string): Promise<MediaProbe> {
  const { stdout } = await run(env().FFPROBE_PATH, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type",
    "-of", "json",
    path,
  ], { timeoutMs: 120_000 });
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: { codec_type?: string }[] };
  const durationSec = Number(info.format?.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new PipelineError("We could not read this recording. The file may be corrupt or incomplete.");
  }
  const types = new Set((info.streams ?? []).map((s) => s.codec_type));
  return { durationMs: Math.round(durationSec * 1000), hasAudio: types.has("audio"), hasVideo: types.has("video") };
}

/**
 * Normalises any input to mono 16 kHz MP3 at 32 kbit/s: what speech models
 * are trained on, and ~14 MB per hour so most lectures fit one request.
 */
export async function extractAudio(ctx: IngestContext, inputPath: string): Promise<string> {
  const out = join(ctx.workDir, "audio.mp3");
  await run(env().FFMPEG_PATH, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", inputPath,
    "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libmp3lame", "-b:a", "32k",
    out,
  ], { timeoutMs: 60 * 60 * 1000 });

  const key = keys.derived(ctx.storagePrefix, "audio.mp3");
  const size = await uploadFile(key, out, "audio/mpeg");
  await db.sourceAsset.upsert({
    where: { storageKey: key },
    create: { sourceId: ctx.source.id, role: "AUDIO_EXTRACT", storageKey: key, mimeType: "audio/mpeg", sizeBytes: BigInt(size) },
    update: { sizeBytes: BigInt(size) },
  });
  return out;
}

export type AudioPart = { path: string; startMs: number; endMs: number };

/**
 * Cuts long audio into parts of about `chunkSeconds` (and under the provider's
 * size limit), placing each cut inside a pause found by ffmpeg's silencedetect
 * so words are never split. Parts are short enough to finish well within the
 * request timeout, report progress steadily, and be resumed on retry.
 */
export async function splitAudio(
  ctx: IngestContext,
  audioPath: string,
  durationMs: number,
  limits: { maxBytes: number; chunkSeconds: number },
): Promise<AudioPart[]> {
  const { size } = await stat(audioPath);
  const bytesPerMs = size / Math.max(1, durationMs);
  const targetMs = Math.max(60_000, Math.min(limits.chunkSeconds * 1000, Math.floor((limits.maxBytes * 0.9) / bytesPerMs)));
  if (durationMs <= targetMs * 1.2) return [{ path: audioPath, startMs: 0, endMs: durationMs }];

  const { stderr } = await run(
    env().FFMPEG_PATH,
    ["-nostdin", "-hide_banner", "-loglevel", "info", "-i", audioPath, "-af", "silencedetect=noise=-35dB:d=0.35", "-f", "null", "-"],
    { timeoutMs: 20 * 60 * 1000, maxStderrBytes: 8 * 1024 * 1024 },
  );
  const spans = planCuts(durationMs, parseSilences(stderr), targetMs);

  const partsDir = join(ctx.workDir, "parts");
  await mkdir(partsDir, { recursive: true });
  const parts: AudioPart[] = [];
  for (const [i, span] of spans.entries()) {
    const path = join(partsDir, `part_${String(i).padStart(3, "0")}.mp3`);
    await run(env().FFMPEG_PATH, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-ss", (span.startMs / 1000).toFixed(3), "-to", (span.endMs / 1000).toFixed(3),
      "-i", audioPath, "-c", "copy", path,
    ]);
    parts.push({ path, ...span });
  }
  const onDisk = new Set(await readdir(partsDir));
  if (parts.some((p) => !onDisk.has(p.path.slice(partsDir.length + 1)))) {
    throw new PipelineError("A processing step failed on this file.", { detail: "audio parts missing after splitting" });
  }
  await ctx.log("INFO", `Split the recording into ${parts.length} parts of about ${Math.round(targetMs / 60_000)} min, cut at pauses`);
  return parts;
}

/** Downloads the audio track of a YouTube video with yt-dlp. */
export async function downloadYouTube(ctx: IngestContext): Promise<{ path: string; title: string | null }> {
  const url = ctx.source.externalUrl;
  if (!url) throw new PipelineError("This source has no link to import.");
  const { stdout } = await run(env().YTDLP_PATH, [
    "--no-playlist",
    "--no-progress",
    "-f", "bestaudio/best",
    "--max-filesize", "1024M",
    "-o", join(ctx.workDir, "youtube.%(ext)s"),
    "--no-simulate",
    "--print", "title",
    "--print", "after_move:filepath",
    url,
  ], { timeoutMs: 60 * 60 * 1000 });
  const [title, path] = stdout.trim().split("\n").map((l) => l.trim());
  if (!path) throw new PipelineError("We could not download this video. It may be private, age-restricted or removed.");
  return { path, title: title ?? null };
}
