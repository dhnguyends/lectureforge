import { describe, expect, it } from "vitest";
import { classifyFile, estimateProcessing, validateFile } from "@/lib/uploads/policy";
import { contentMatchesKind, sniff } from "@/lib/uploads/sniff";

const MB = 1024 * 1024;

describe("classifyFile", () => {
  it("classifies by extension and accepts matching MIME types", () => {
    expect(classifyFile({ name: "Lecture 07 - Backprop.mp4", mimeType: "video/mp4" })).toEqual({ ok: true, kind: "VIDEO", mimeType: "video/mp4" });
    expect(classifyFile({ name: "slides.PPTX", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" })).toMatchObject({ ok: true, kind: "SLIDES" });
    expect(classifyFile({ name: "paper.pdf", mimeType: "application/pdf" })).toMatchObject({ ok: true, kind: "PDF" });
  });

  it("classifies Word, OpenDocument and RTF files as documents", () => {
    expect(classifyFile({ name: "Notes.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toMatchObject({ ok: true, kind: "DOCUMENT" });
    expect(classifyFile({ name: "old.DOC", mimeType: "application/msword" })).toMatchObject({ ok: true, kind: "DOCUMENT" });
    expect(classifyFile({ name: "essay.odt", mimeType: "" })).toMatchObject({ ok: true, kind: "DOCUMENT" });
    expect(classifyFile({ name: "memo.rtf", mimeType: "text/rtf" })).toMatchObject({ ok: true, kind: "DOCUMENT" });
    expect(classifyFile({ name: "deck.ppt", mimeType: "application/vnd.ms-powerpoint" })).toMatchObject({ ok: true, kind: "SLIDES" });
    expect(classifyFile({ name: "deck.odp", mimeType: "application/vnd.oasis.opendocument.presentation" })).toMatchObject({ ok: true, kind: "SLIDES" });
    // A .docx that claims to be a PDF is refused.
    expect(classifyFile({ name: "Notes.docx", mimeType: "application/pdf" })).toMatchObject({ ok: false });
  });

  it("falls back to the canonical type when the browser reports none", () => {
    expect(classifyFile({ name: "notes.md", mimeType: "" })).toEqual({ ok: true, kind: "NOTE", mimeType: "text/markdown" });
    expect(classifyFile({ name: "talk.mkv", mimeType: "application/octet-stream" })).toEqual({ ok: true, kind: "VIDEO", mimeType: "video/mp4" });
  });

  it("accepts audio-only webm", () => {
    expect(classifyFile({ name: "recording.webm", mimeType: "audio/webm" })).toEqual({ ok: true, kind: "VIDEO", mimeType: "audio/webm" });
    expect(classifyFile({ name: "recording.mp4", mimeType: "audio/mp4" })).toMatchObject({ ok: true, kind: "VIDEO" });
    expect(classifyFile({ name: "recording.ogg", mimeType: "audio/ogg" })).toMatchObject({ ok: true, kind: "AUDIO" });
  });

  it("rejects unsupported extensions and mismatched types", () => {
    expect(classifyFile({ name: "setup.exe", mimeType: "application/x-msdownload" })).toMatchObject({ ok: false });
    expect(classifyFile({ name: "paper.pdf", mimeType: "video/mp4" })).toMatchObject({ ok: false });
    expect(classifyFile({ name: "noextension", mimeType: "" })).toMatchObject({ ok: false });
  });
});

describe("validateFile", () => {
  it("enforces per-kind size limits", () => {
    expect(validateFile({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 201 * MB })).toMatchObject({ ok: false });
    expect(validateFile({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 5 * MB })).toMatchObject({ ok: true });
    expect(validateFile({ name: "a.png", mimeType: "image/png", sizeBytes: 26 * MB })).toMatchObject({ ok: false });
  });

  it("rejects empty files and absurd names", () => {
    expect(validateFile({ name: "a.pdf", mimeType: "application/pdf", sizeBytes: 0 })).toMatchObject({ ok: false });
    expect(validateFile({ name: `${"x".repeat(300)}.pdf`, mimeType: "application/pdf", sizeBytes: 10 })).toMatchObject({ ok: false });
  });
});

describe("estimateProcessing", () => {
  it("scales media estimates with duration", () => {
    const short = estimateProcessing({ kind: "VIDEO", sizeBytes: 100 * MB, durationMs: 10 * 60_000 });
    const long = estimateProcessing({ kind: "VIDEO", sizeBytes: 100 * MB, durationMs: 90 * 60_000 });
    expect(long.maxSeconds).toBeGreaterThan(short.maxSeconds);
    expect(short.minSeconds).toBeLessThan(short.maxSeconds);
  });

  it("produces sane document estimates", () => {
    const e = estimateProcessing({ kind: "PDF", sizeBytes: 3 * MB });
    expect(e.minSeconds).toBeGreaterThan(0);
    expect(e.maxSeconds).toBeLessThan(3600);
  });
});

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe("sniff", () => {
  it("detects container formats from magic bytes", () => {
    expect(sniff(bytes([0, 0, 0, 0x20], "ftypisom"))).toBe("iso-bmff");
    expect(sniff(bytes("%PDF-1.7\n"))).toBe("pdf");
    expect(sniff(bytes([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe("zip");
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe("matroska");
    expect(sniff(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt "))).toBe("wav");
    expect(sniff(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("webp");
    expect(sniff(bytes("ID3", [4, 0]))).toBe("mp3");
    expect(sniff(bytes([0xff, 0xfb, 0x90]))).toBe("mp3");
    expect(sniff(bytes([0xff, 0xf1, 0x50]))).toBe("aac");
    expect(sniff(bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).toBe("ole2");
    // RTF is plain ASCII, so it must be recognised before the text check.
    expect(sniff(bytes(String.raw`{\rtf1\ansi Hello}`))).toBe("rtf");
    expect(sniff(bytes("# Lecture notes\n\n$E = mc^2$\n"))).toBe("text");
  });

  it("treats binary with NUL bytes as unknown", () => {
    expect(sniff(bytes([0x4d, 0x5a, 0x90, 0x00, 0x03]))).toBe("unknown");
  });

  it("checks content against declared kind", () => {
    expect(contentMatchesKind("PDF", bytes("%PDF-1.4"))).toBe(true);
    // An executable renamed to .pdf must be rejected.
    expect(contentMatchesKind("PDF", bytes([0x4d, 0x5a, 0x90, 0x00]))).toBe(false);
    expect(contentMatchesKind("VIDEO", bytes([0, 0, 0, 0x18], "ftypmp42"))).toBe(true);
    expect(contentMatchesKind("NOTE", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(false);
    expect(contentMatchesKind("DOCUMENT", bytes([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(contentMatchesKind("DOCUMENT", bytes(String.raw`{\rtf1`))).toBe(true);
    expect(contentMatchesKind("DOCUMENT", bytes("%PDF-1.4"))).toBe(false);
    expect(contentMatchesKind("SLIDES", bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(true);
  });
});
