import { formatTimestamp } from "./time";

export type CaptionSegment = { startMs: number; endMs: number; text: string; speaker?: string | null };

/** WebVTT caption track from transcript segments. Cue text is escaped per the spec. */
export function toWebVtt(segments: CaptionSegment[]): string {
  const cues = segments
    .filter((s) => s.text.trim() && s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs)
    .map((s, i) => {
      // Escaping ">" also neutralises any "-->" inside cue text.
      const text = s.text.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const voice = s.speaker ? `<v ${s.speaker.replace(/[<>&]/g, "")}>` : "";
      return `${i + 1}\n${formatTimestamp(s.startMs)} --> ${formatTimestamp(s.endMs)}\n${voice}${text}`;
    });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/** Index of the segment playing at `ms` (binary search over start times), or -1. */
export function segmentAt(segments: { startMs: number; endMs: number }[], ms: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.startMs <= ms) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (found === -1) return -1;
  // In a gap after a segment ends, keep the previous one highlighted briefly.
  return ms <= segments[found]!.endMs + 1500 ? found : -1;
}
