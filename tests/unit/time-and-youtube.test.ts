import { describe, expect, it } from "vitest";
import { formatClock, formatDurationRange, formatTimestamp, isTimestamp, parseTimestamp } from "@/lib/time";
import { parseYouTubeUrl } from "@/lib/youtube";

describe("timestamps", () => {
  it("formats and parses the citation format round-trip", () => {
    expect(formatTimestamp(761_000)).toBe("00:12:41.000");
    expect(formatTimestamp(798_500)).toBe("00:13:18.500");
    expect(formatTimestamp(3_723_004)).toBe("01:02:03.004");
    for (const ms of [0, 1, 999, 59_999, 761_000, 36_000_000]) {
      expect(parseTimestamp(formatTimestamp(ms))).toBe(ms);
    }
  });

  it("accepts fractional seconds with fewer digits", () => {
    expect(parseTimestamp("00:00:01.5")).toBe(1500);
    expect(parseTimestamp("00:00:01")).toBe(1000);
  });

  it("rejects malformed values", () => {
    expect(isTimestamp("12:41")).toBe(false);
    expect(isTimestamp("00:61:00.000")).toBe(false);
    expect(() => formatTimestamp(-1)).toThrow();
  });

  it("formats short clock labels", () => {
    expect(formatClock(761_000)).toBe("12:41");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });
});

describe("parseYouTubeUrl", () => {
  const id = "dQw4w9WgXcQ";
  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}?si=abc`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/live/${id}`,
  ])("extracts the id from %s", (url) => {
    expect(parseYouTubeUrl(url)).toEqual({ videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${id}` });
  });

  it.each([
    "https://evil.example/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
    "javascript:alert(1)",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/playlist?list=PL123",
    "not a url",
  ])("rejects %s", (url) => {
    expect(parseYouTubeUrl(url)).toBeNull();
  });
});

describe("formatDurationRange", () => {
  it("never repeats the same wording on both ends", () => {
    expect(formatDurationRange(14, 39)).toBe("under a minute");
    expect(formatDurationRange(30, 240)).toBe("up to 4 min");
    expect(formatDurationRange(70, 80)).toBe("about 1 min");
    expect(formatDurationRange(120, 540)).toBe("about 2 min – 9 min");
  });
});
