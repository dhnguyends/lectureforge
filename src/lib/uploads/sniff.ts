import type { UploadKind } from "./policy";

/** Container/format families detectable from the first bytes of a file. */
export type SniffedFamily =
  | "iso-bmff" // mp4, mov, m4a
  | "matroska" // mkv, webm
  | "mp3"
  | "wav"
  | "flac"
  | "ogg"
  | "aac"
  | "pdf"
  | "zip" // docx, pptx, odt, odp
  | "ole2" // legacy .doc / .ppt
  | "rtf"
  | "png"
  | "jpeg"
  | "webp"
  | "text"
  | "unknown";

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function sniff(buf: Uint8Array): SniffedFamily {
  if (startsWith(buf, ascii("ftyp"), 4)) return "iso-bmff";
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "matroska";
  if (startsWith(buf, ascii("%PDF-"))) return "pdf";
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole2";
  if (startsWith(buf, ascii("{\\rtf"))) return "rtf";
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return "zip";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8)) return "webp";
  if (startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WAVE"), 8)) return "wav";
  if (startsWith(buf, ascii("fLaC"))) return "flac";
  if (startsWith(buf, ascii("OggS"))) return "ogg";
  if (startsWith(buf, ascii("ID3"))) return "mp3";
  // MPEG audio frame sync (11 set bits). Layer bits distinguish MP3 from ADTS AAC.
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) {
    return (buf[1]! & 0x06) === 0 ? "aac" : "mp3";
  }
  if (looksLikeText(buf)) return "text";
  return "unknown";
}

function looksLikeText(buf: Uint8Array): boolean {
  if (buf.length === 0) return false;
  if (buf.includes(0)) return false;
  try {
    // fatal: true rejects invalid UTF-8. A multi-byte char may be cut at the
    // end of the sample, so ignore the last 3 bytes.
    new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(0, Math.max(1, buf.length - 3)));
    return true;
  } catch {
    return false;
  }
}

const ALLOWED: Record<UploadKind, SniffedFamily[]> = {
  VIDEO: ["iso-bmff", "matroska"],
  AUDIO: ["iso-bmff", "matroska", "mp3", "wav", "flac", "ogg", "aac"],
  PDF: ["pdf"],
  SLIDES: ["zip", "ole2"],
  DOCUMENT: ["zip", "ole2", "rtf"],
  IMAGE: ["png", "jpeg", "webp"],
  NOTE: ["text"],
};

/** True when the file's actual bytes are consistent with its declared kind. */
export function contentMatchesKind(kind: UploadKind, head: Uint8Array): boolean {
  return ALLOWED[kind].includes(sniff(head));
}
