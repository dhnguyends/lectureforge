export type TranscribedSegment = {
  startMs: number;
  endMs: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
};

export type TranscriptionResult = {
  language: string | null;
  model: string;
  segments: TranscribedSegment[];
};

export type TranscriptionRequest = {
  filePath: string;
  mimeType: string;
  /** null = auto-detect */
  language: string | null;
  diarize: boolean;
  /** Domain vocabulary to bias recognition (course title, key terms). */
  prompt?: string;
};

export interface TranscriptionProvider {
  readonly name: string;
  /** Largest file this provider accepts in one request; the pipeline splits audio above it. */
  readonly maxBytes: number;
  readonly supportsDiarization: boolean;
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>;
}
