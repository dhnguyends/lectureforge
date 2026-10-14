/**
 * Upload policy shared by the browser (pre-flight validation and estimates)
 * and the server (authoritative validation). Pure — no Node or DOM APIs.
 */

export type UploadKind = "VIDEO" | "AUDIO" | "PDF" | "SLIDES" | "DOCUMENT" | "IMAGE" | "NOTE";

type KindRule = {
  label: string;
  maxBytes: number;
  extensions: string[];
  mimeTypes: string[];
};

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const UPLOAD_RULES: Record<UploadKind, KindRule> = {
  VIDEO: {
    label: "Video",
    // Single presigned PUT is capped at 5 GB by S3; stay under it.
    maxBytes: 4 * GB,
    extensions: ["mp4", "m4v", "mov", "webm", "mkv"],
    mimeTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska", "video/x-m4v"],
  },
  AUDIO: {
    label: "Audio",
    maxBytes: 1 * GB,
    extensions: ["mp3", "m4a", "wav", "flac", "ogg", "oga", "opus", "aac"],
    mimeTypes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/x-m4a",
      "audio/wav",
      "audio/x-wav",
      "audio/wave",
      "audio/flac",
      "audio/x-flac",
      "audio/ogg",
      "audio/opus",
      "audio/aac",
      "audio/webm",
    ],
  },
  PDF: {
    label: "PDF",
    maxBytes: 200 * MB,
    extensions: ["pdf"],
    mimeTypes: ["application/pdf"],
  },
  SLIDES: {
    label: "Slides",
    maxBytes: 200 * MB,
    extensions: ["pptx", "ppt", "odp"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-powerpoint",
      "application/vnd.oasis.opendocument.presentation",
    ],
  },
  DOCUMENT: {
    label: "Word document",
    maxBytes: 100 * MB,
    extensions: ["docx", "doc", "odt", "rtf"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/vnd.oasis.opendocument.text",
      "application/rtf",
      "text/rtf",
    ],
  },
  IMAGE: {
    label: "Image / handwritten notes",
    maxBytes: 25 * MB,
    extensions: ["png", "jpg", "jpeg", "webp"],
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
  NOTE: {
    label: "Text notes",
    maxBytes: 5 * MB,
    extensions: ["md", "markdown", "txt", "tex"],
    mimeTypes: ["text/markdown", "text/plain", "text/x-markdown", "application/x-tex", "text/x-tex"],
  },
};

export const ACCEPT_ATTRIBUTE: Record<string, string[]> = Object.fromEntries(
  Object.values(UPLOAD_RULES).flatMap((rule) =>
    rule.mimeTypes.map((mime) => [mime, rule.extensions.map((e) => `.${e}`)]),
  ),
);

export const MAX_SOURCES_PER_STUDY_SET = 50;

export type FileDescriptor = { name: string; mimeType: string; sizeBytes: number };

export type ClassifyResult =
  | { ok: true; kind: UploadKind; mimeType: string }
  | { ok: false; reason: string };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * Classifies a file by extension, then checks the declared MIME type agrees.
 * Browsers often report an empty or generic type (e.g. for .md or .mkv), so an
 * empty / octet-stream type falls back to the extension's canonical type.
 * The worker later re-checks the actual bytes (see sniff.ts).
 */
export function classifyFile(file: Pick<FileDescriptor, "name" | "mimeType">): ClassifyResult {
  const ext = extensionOf(file.name);
  const entry = (Object.entries(UPLOAD_RULES) as [UploadKind, KindRule][]).find(([, r]) =>
    r.extensions.includes(ext),
  );
  if (!entry) {
    return { ok: false, reason: `“.${ext || "?"}” files are not supported.` };
  }
  const [kind, rule] = entry;
  const declared = file.mimeType.toLowerCase().split(";")[0]!.trim();
  if (declared === "" || declared === "application/octet-stream") {
    return { ok: true, kind, mimeType: rule.mimeTypes[0]! };
  }
  // .webm / .mp4 / .mkv may legitimately be audio-only; the pipeline extracts
  // audio from either, so keep the VIDEO kind but accept the audio type.
  const audioInVideoContainer = kind === "VIDEO" && UPLOAD_RULES.AUDIO.mimeTypes.includes(declared);
  if (!rule.mimeTypes.includes(declared) && !audioInVideoContainer) {
    return { ok: false, reason: `File type “${declared}” does not match the .${ext} extension.` };
  }
  return { ok: true, kind, mimeType: declared };
}

export function validateFile(file: FileDescriptor): ClassifyResult {
  if (!file.name || file.name.length > 255) return { ok: false, reason: "File name is missing or too long." };
  if (file.sizeBytes <= 0) return { ok: false, reason: "File is empty." };
  const result = classifyFile(file);
  if (!result.ok) return result;
  const rule = UPLOAD_RULES[result.kind];
  if (file.sizeBytes > rule.maxBytes) {
    return {
      ok: false,
      reason: `${rule.label} files can be up to ${Math.round(rule.maxBytes / MB).toLocaleString()} MB.`,
    };
  }
  return result;
}

export type ProcessingEstimate = { minSeconds: number; maxSeconds: number };

/**
 * Rough processing-time estimate shown before upload. Media cost is driven by
 * duration (transcription), documents by page count (parsing + OCR).
 * `durationMs` / `pageCount` are measured in the browser when possible;
 * otherwise we infer them from size with conservative bitrate assumptions.
 */
export function estimateProcessing(input: {
  kind: UploadKind | "YOUTUBE";
  sizeBytes?: number;
  durationMs?: number;
  pageCount?: number;
}): ProcessingEstimate {
  const size = input.sizeBytes ?? 0;
  switch (input.kind) {
    case "VIDEO":
    case "AUDIO":
    case "YOUTUBE": {
      // Fallback bitrates: ~2.5 Mbit/s lecture video, ~128 kbit/s audio.
      const bytesPerSecond = input.kind === "AUDIO" ? 16_000 : 312_500;
      const durationSec = input.durationMs ? input.durationMs / 1000 : size / bytesPerSecond || 3600;
      const extraction = input.kind === "VIDEO" ? size / (40 * MB) : 0;
      // Hosted STT typically runs at 5–20% of real time.
      const base = 20 + extraction;
      return {
        minSeconds: Math.round(base + durationSec * 0.05),
        maxSeconds: Math.round(base * 1.5 + durationSec * 0.2),
      };
    }
    case "PDF":
    case "SLIDES":
    case "DOCUMENT": {
      // Word files are compact: ~30 KB of .docx per page is a rough average.
      const bytesPerPage = input.kind === "DOCUMENT" ? 30 * 1024 : 150 * 1024;
      const pages = input.pageCount ?? Math.max(1, Math.round(size / bytesPerPage));
      const conversion = input.kind === "PDF" ? 0 : 15;
      // Text extraction is fast; scanned pages needing OCR dominate the max.
      return { minSeconds: Math.round(10 + conversion + pages * 0.3), maxSeconds: Math.round(20 + conversion + pages * 4) };
    }
    case "IMAGE":
      return { minSeconds: 10, maxSeconds: 45 };
    case "NOTE":
      return { minSeconds: 5, maxSeconds: 20 };
  }
}
