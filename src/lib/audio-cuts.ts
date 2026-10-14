/**
 * Planning where to cut long recordings for transcription. Cutting inside a
 * pause keeps words whole, so no overlap/de-duplication is needed and every
 * part's timestamps stay exact.
 */

export type Silence = { startMs: number; endMs: number };
export type AudioSpan = { startMs: number; endMs: number };

/** Parses ffmpeg `silencedetect` output (stderr). */
export function parseSilences(ffmpegOutput: string): Silence[] {
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of ffmpegOutput.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      start = Math.max(0, Number(s[1]) * 1000);
      continue;
    }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ startMs: Math.round(start), endMs: Math.round(Number(e[1]) * 1000) });
      start = null;
    }
  }
  return out;
}

/**
 * Splits [0, durationMs] into spans of about `targetMs`, moving each cut to the
 * middle of the nearest pause within ±windowMs of the ideal point (longer
 * pauses win ties). Falls back to the ideal point when there is no pause.
 * A short remainder is merged into the last span rather than left on its own.
 */
export function planCuts(durationMs: number, silences: Silence[], targetMs: number, windowMs = Math.min(45_000, targetMs / 4)): AudioSpan[] {
  if (durationMs <= targetMs * 1.2) return [{ startMs: 0, endMs: durationMs }];
  const cuts: number[] = [];
  let ideal = targetMs;
  while (ideal < durationMs - targetMs * 0.3) {
    const candidates = silences
      .map((s) => ({ mid: Math.round((s.startMs + s.endMs) / 2), len: s.endMs - s.startMs }))
      .filter((c) => Math.abs(c.mid - ideal) <= windowMs && c.mid > (cuts.at(-1) ?? 0) + targetMs / 2);
    // Prefer pauses close to the ideal point, then longer ones.
    candidates.sort((a, b) => Math.abs(a.mid - ideal) - a.len * 2 - (Math.abs(b.mid - ideal) - b.len * 2));
    const cut = candidates[0]?.mid ?? ideal;
    cuts.push(cut);
    ideal = cut + targetMs;
  }
  const bounds = [0, ...cuts, durationMs];
  return bounds.slice(1).map((end, i) => ({ startMs: bounds[i]!, endMs: end }));
}
