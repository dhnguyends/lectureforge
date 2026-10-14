import type { ProcessingStage, SourceKind } from "./contracts/source";

/** Ordered processing stages per source kind. Shared by the worker and the UI stepper. */
export const STAGE_PLANS: Record<SourceKind, ProcessingStage[]> = {
  VIDEO: ["SCANNING", "EXTRACTING_AUDIO", "TRANSCRIBING", "SEGMENTING", "INDEXING"],
  AUDIO: ["SCANNING", "EXTRACTING_AUDIO", "TRANSCRIBING", "SEGMENTING", "INDEXING"],
  YOUTUBE: ["UPLOADING", "EXTRACTING_AUDIO", "TRANSCRIBING", "SEGMENTING", "INDEXING"],
  PDF: ["SCANNING", "PARSING_DOCUMENT", "OCR", "SEGMENTING", "INDEXING"],
  SLIDES: ["SCANNING", "PARSING_DOCUMENT", "OCR", "SEGMENTING", "INDEXING"],
  DOCUMENT: ["SCANNING", "PARSING_DOCUMENT", "OCR", "SEGMENTING", "INDEXING"],
  IMAGE: ["SCANNING", "OCR", "SEGMENTING", "INDEXING"],
  NOTE: ["SCANNING", "PARSING_DOCUMENT", "SEGMENTING", "INDEXING"],
};

export const STAGE_LABELS: Record<ProcessingStage, string> = {
  UPLOADING: "Fetching",
  SCANNING: "Safety check",
  EXTRACTING_AUDIO: "Extracting audio",
  TRANSCRIBING: "Transcribing",
  PARSING_DOCUMENT: "Parsing",
  OCR: "Text recognition",
  SEGMENTING: "Segmenting",
  INDEXING: "Indexing",
  GENERATING: "Generating",
  VALIDATING: "Validating",
  COMPLETE: "Complete",
};
