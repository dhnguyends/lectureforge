import { z } from "zod";

/**
 * Server-side configuration. Parsed lazily so that `next build` and unit tests
 * do not require a fully populated environment. Never import this from client
 * components — secrets live only on the server.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // There is no public sign-up page: accounts are created on the admin page.
  // This list (comma-separated emails and/or "@domain" entries; empty = any)
  // still limits account creation through any other path, e.g. OAuth sign-in
  // if GitHub/Google credentials are configured.
  SIGNUP_ALLOWED_EMAILS: z.string().default(""),
  // Site-wide password asked before anything else (pages and API); empty = off.
  // Read directly by the middleware (src/lib/access-gate.ts).
  LECTURE_ACCESS_KEY: z.string().optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Object storage (S3-compatible)
  S3_ENDPOINT: z.url().optional(),
  // Endpoint the *browser* uses for presigned uploads, if different from the
  // one the server/worker uses (e.g. Docker-internal hostname vs localhost).
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  // Speech-to-text
  TRANSCRIPTION_PROVIDER: z.enum(["openai-compatible", "deepgram"]).default("openai-compatible"),
  TRANSCRIPTION_BASE_URL: z.url().default("https://api.openai.com/v1"),
  TRANSCRIPTION_API_KEY: z.string().optional(),
  TRANSCRIPTION_MODEL: z.string().default("whisper-1"),
  // Audio larger than this is split before transcription (hosted OpenAI caps uploads at 25 MB).
  TRANSCRIPTION_MAX_MB: z.coerce.number().positive().default(24),
  // Long recordings are cut (inside pauses) into parts of about this length:
  // steady progress, bounded request time, and resumable retries.
  TRANSCRIPTION_CHUNK_SECONDS: z.coerce.number().int().min(60).max(1800).default(300),
  // Upper bound for transcribing one part before the request is abandoned.
  TRANSCRIPTION_PART_TIMEOUT_SECONDS: z.coerce.number().int().min(60).default(1800),
  // Parts transcribed at the same time by this worker. A single GPU is fastest at 1.
  TRANSCRIPTION_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_MODEL: z.string().default("nova-3"),

  // Generation model. "anthropic" uses the official SDK; "openai-compatible"
  // covers OpenAI and local servers (Ollama, LM Studio, vLLM).
  AI_PROVIDER: z.enum(["anthropic", "openai-compatible"]).default("anthropic"),
  // An empty value (as in .env.example) counts as unset.
  ANTHROPIC_API_KEY: z.string().optional().transform((v) => v?.trim() || undefined),
  // Deliberately not ANTHROPIC_BASE_URL, which developer tools may set in the
  // environment of processes they launch.
  AI_ANTHROPIC_BASE_URL: z.url().default("https://api.anthropic.com"),
  // The Claude model and effort are chosen on the admin page (src/lib/app-settings.ts).
  // On a safety-classifier decline, let the API retry on a fallback model.
  AI_REFUSAL_FALLBACK: z.stringbool().default(true),
  OPENAI_COMPAT_BASE_URL: z.url().default("http://localhost:11434/v1"),
  OPENAI_COMPAT_API_KEY: z.string().optional(),
  OPENAI_COMPAT_MODEL: z.string().default("qwen2.5:14b"),
  GENERATION_CONCURRENCY: z.coerce.number().int().positive().default(3),

  // Embeddings (default: EmbeddingGemma on local Ollama; the DB column is vector(768))
  EMBEDDING_PROVIDER: z.enum(["openai-compatible", "none"]).default("openai-compatible"),
  EMBEDDING_BASE_URL: z.url().default("http://localhost:11434/v1"),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default("embeddinggemma"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  // Some OpenAI-compatible servers reject the `dimensions` parameter.
  EMBEDDING_SEND_DIMENSIONS: z.stringbool().default(false),
  EMBEDDING_QUERY_PREFIX: z.string().default("task: search result | query: "),
  EMBEDDING_DOCUMENT_PREFIX: z.string().default("title: none | text: "),

  // Local models via Ollama: the tutor chatbot and vision OCR
  OLLAMA_BASE_URL: z.url().default("http://localhost:11434"),
  TUTOR_MODEL: z.string().default("gemma4:latest"),
  // Gemma 4 can reason before answering: better hints, slower replies.
  TUTOR_THINK: z.stringbool().default(false),
  TUTOR_NUM_CTX: z.coerce.number().int().positive().default(16384),
  OCR_VISION_MODEL: z.string().default("gemma4:latest"),
  OCR_NUM_CTX: z.coerce.number().int().positive().default(8192),
  // How long Ollama keeps a model loaded after a request ("30m", or -1 for good).
  // On a server whose Ollama is shared with other apps, send exactly what they
  // send (and the same num_ctx): any difference makes Ollama reload the model.
  OLLAMA_KEEP_ALIVE: z.string().default("30m"),

  // OCR
  // "hybrid": Tesseract (line boxes for precise citations), falling back to the
  // vision model when Tesseract is unsure (e.g. handwriting).
  OCR_PROVIDER: z.enum(["none", "tesseract", "ollama-vision", "hybrid"]).default("none"),
  OCR_MIN_CONFIDENCE: z.coerce.number().min(0).max(100).default(70),
  TESSERACT_PATH: z.string().default("tesseract"),
  PDFTOPPM_PATH: z.string().default("pdftoppm"),

  // Media tooling
  FFMPEG_PATH: z.string().default("ffmpeg"),
  FFPROBE_PATH: z.string().default("ffprobe"),
  SOFFICE_PATH: z.string().default("soffice"),

  // YouTube ingestion is off unless the operator enables it and accepts
  // responsibility for complying with YouTube's terms in their deployment.
  ENABLE_YOUTUBE_INGEST: z.stringbool().default(false),
  YTDLP_PATH: z.string().default("yt-dlp"),

  // Malware scanning
  MALWARE_SCANNER: z.enum(["none", "clamav"]).default("none"),
  CLAMAV_HOST: z.string().default("localhost"),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  // Worker
  WORKER_TMP_DIR: z.string().optional(),
  INGEST_CONCURRENCY: z.coerce.number().int().positive().default(2),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
      throw new Error(`Invalid server environment:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}
