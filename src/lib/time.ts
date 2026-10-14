/** Formats milliseconds as the citation timestamp format "HH:MM:SS.mmm". */
export function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) throw new RangeError(`Invalid timestamp: ${ms}`);
  const total = Math.round(ms);
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  const milli = total % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(milli, 3)}`;
}

/** Short display form: "1:02:03" or "12:41". */
export function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${m}:${pad(s, 2)}`;
}

const TIMESTAMP_RE = /^(\d{2,}):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/;

export function parseTimestamp(value: string): number {
  const match = TIMESTAMP_RE.exec(value);
  if (!match) throw new RangeError(`Invalid timestamp: ${value}`);
  const [, h, m, s, frac = "0"] = match;
  return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(frac.padEnd(3, "0"));
}

export function isTimestamp(value: string): boolean {
  return TIMESTAMP_RE.test(value);
}

/** Human duration for estimates: "about 4 min", "1 h 20 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}

/** Estimate range: "under a minute", "up to 3 min", "about 4–9 min"-style wording. */
export function formatDurationRange(minSeconds: number, maxSeconds: number): string {
  const max = formatDuration(maxSeconds);
  if (maxSeconds < 60) return max;
  const min = formatDuration(minSeconds);
  if (min === max) return `about ${max}`;
  if (minSeconds < 60) return `up to ${max}`;
  return `about ${min} – ${max}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}
