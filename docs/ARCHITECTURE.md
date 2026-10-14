# LectureForge — Architecture

## Overview

```
 Browser ──► Next.js (App Router, Vercel)                 Worker (long-lived Node process)
   │           ├─ pages / server components               ├─ ingest queue    ffmpeg · STT · pdf · OCR · embeddings
   │           ├─ /api/* route handlers ──► Postgres ◄────┤─ generation queue retrieve → generate → validate (next phase)
   │           └─ Auth.js (JWT sessions)    (pgvector)    └─ maintenance     purges, exports
   │                         │                 ▲
   │                         └──► Redis (BullMQ, rate limits) ◄──┘
   └── presigned PUT ───────────► S3-compatible storage ◄────────── worker reads/writes derived assets
```

* **Web** (Next.js) handles auth, validation, authorization, presigning, and reads. It never does heavy work in a request.
* **Worker** (`src/worker/index.ts`) runs anywhere with ffmpeg, LibreOffice, Tesseract and poppler installed. It is not deployed to Vercel.
* **Postgres** is the source of truth for everything including job status. BullMQ jobs carry only a `GenerationJob.id`.
* **Object storage** holds originals and derived files under one prefix per study set: `ws/{workspace}/sets/{set}/sources/{source}/…`, so deleting a set is one prefix purge.

## Domain model

`StudySet` is the unit of ownership. All learning artifacts hang off it and cascade on delete.

```
Workspace ─┬─ Membership(User, role)
           └─ StudySet ─┬─ Source ─┬─ SourceAsset (original, audio extract, normalized pdf…)
                        │          ├─ Transcript ── TranscriptSegment
                        │          └─ ExtractedChunk (text, time/page range, regions, embedding)
                        ├─ StudyGuide ── StudyGuideSection (tree)
                        ├─ FlashcardDeck ── Flashcard ── CardReviewState (per user)
                        ├─ Quiz ── QuizQuestion
                        ├─ ExerciseSet ── Exercise
                        ├─ TutorConversation ── TutorMessage
                        ├─ GenerationJob ── JobEvent
                        └─ StudyPlan ── StudySession;  ProgressMetric;  Attempt (per user)

CitationAnchor → Source (+ chunk, + transcript segment) and exactly one owner:
                 guide section | flashcard | quiz question | exercise | tutor message
```

Key decisions:

| Decision | Why |
|---|---|
| `CitationAnchor` has nullable FKs per owner type rather than a polymorphic `(type, id)` | Real referential integrity and cascades; anchors die with their item. |
| Anchors copy `startMs/endMs/page/region/excerpt` instead of only pointing at a chunk | Re-processing a source replaces chunks (`chunkId` → NULL), but existing citations still resolve to the right moment/page. |
| `CardReviewState` keyed by (card, user) | A deck in a shared workspace keeps an independent schedule per learner. |
| Generated items carry `claimType`, `confidence`, `warnings`, `version`, `editedByUser` | Drives the "Supported by source / Inference / Additional practice" labels, low-confidence warnings, and selective regeneration that won't overwrite user edits. |
| `TranscriptSegment.originalText` kept alongside editable `text` | User edits are auditable and reversible. |
| Private by default; `PRIVATE` sets invisible even to workspace co-members | Matches the privacy principle; sharing is opt-in via `WORKSPACE` visibility. |
| Missing and forbidden study sets both return 404 | IDs cannot be probed. |

## Upload workflow

1. `POST /api/study-sets` creates the set (Zod-validated, rate-limited).
2. `POST /api/study-sets/:id/sources` with `{ type: "upload", filename, mimeType, sizeBytes, durationMs?, rightsConfirmed: true }`
   * validates type by extension + declared MIME, enforces per-kind size limits (`src/lib/uploads/policy.ts`)
   * records the rights attestation (`rightsConfirmedAt/By`) and an audit-log entry
   * returns a presigned PUT whose signature covers `Content-Type` and `Content-Length`
3. Browser PUTs directly to storage with progress (XHR).
4. `POST /api/sources/:id/complete`
   * HEADs the object and checks the size matches
   * range-reads the first 4 KB and checks magic bytes against the declared kind (`src/lib/uploads/sniff.ts`); mismatches are deleted
   * atomically flips `PENDING_UPLOAD → UPLOADED`, creates a `GenerationJob(SOURCE_INGEST)` and enqueues it — idempotent on repeat calls
5. The workspace polls `GET /api/study-sets/:id/status` (2 s while active, 30 s idle).

YouTube links (`type: "youtube"`) are accepted only when `ENABLE_YOUTUBE_INGEST=true`, only for well-known YouTube hosts, and still require the rights attestation.

## Ingest pipeline

`src/server/pipeline/run-ingest.ts`. Stage plans per kind live in `src/lib/pipeline-plan.ts` (shared with the UI stepper).

| Kind | Stages |
|---|---|
| Video / audio | scan → probe + extract mono 16 kHz audio (+ split under provider limit) → transcribe → segment → index |
| YouTube | fetch (yt-dlp) → extract → transcribe → segment → index |
| PDF / slides / Word | scan → (pptx/ppt/odp/docx/doc/odt/rtf → pdf via headless LibreOffice; one shared profile, one conversion at a time) → parse text with per-line bounding boxes → OCR pages with no text layer → segment → index |
| Image | scan → OCR (line boxes) → segment → index |
| Text notes | scan → read → segment (line ranges) → index |

Properties:

* **Idempotent stages**: transcript and chunks are replaced in a transaction, so BullMQ retries converge.
* **Retry policy**: `PipelineError.retryable` separates transient faults (provider 429/5xx, timeouts) from permanent ones (corrupt file, no audio). Permanent errors throw `UnrecoverableError` to skip remaining attempts. On the last attempt the source is `FAILED` with a user-actionable message; technical detail goes to `JobEvent.data` and logs.
* **Orphan sweep**: the worker re-enqueues `QUEUED` rows older than a minute (e.g. Redis was briefly down when the API wrote them).
* **Chunking** (`src/lib/chunking/`) never splits a transcript segment, code block, or equation, and never crosses a page, so every chunk maps to exactly one time range or one page region. Headings propagate as `headingPath`.
* **Embeddings** are optional (`EMBEDDING_PROVIDER=none`); a GIN full-text index provides keyword search either way.
* **Safety**: external tools run via `spawn` without a shell; ClamAV INSTREAM scanning is pluggable; temp dirs are always removed.

## Generation

```
GenerationJob ─► worker generation queue ─► run.ts (status, retries, token audit)
                                              └─► registry: GENERATE_STUDY_GUIDE | REGENERATE_ITEM | …
study guide:  all chunks ─► outline (model) ─► per section: outline refs + hybrid retrieval
              ─► section (model) ─► validateSection (code) ─► buildAnchors ─► rows + ArtifactRevision
```

**Provider layer** (`src/server/ai/`): `ChatModel.generateJson(system, prompt, zodSchema)`.
* `anthropic.ts` uses the official SDK: streaming, structured outputs (JSON schema derived from the Zod schema), adaptive thinking with `AI_EFFORT`, a cached system prompt, and server-side refusal fallback (`fallbacks: "default"`; disable with `AI_REFUSAL_FALLBACK=false`).
* `openai-compatible.ts` covers OpenAI, Ollama, LM Studio and vLLM.
* Output that fails the Zod schema goes back to the model once with the errors. Typed SDK errors are mapped to retryable or permanent.
* **Credentials are explicit.** The client is built with `authToken: null` and a fixed `baseURL`, so ambient `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` (e.g. from a developer tool that launched the process) are never used. `isAiConfigured()` is true only with `ANTHROPIC_API_KEY`.

**Retrieval** (`src/server/retrieval.ts`): keyword search (`to_tsquery` over the GIN index, OR-query built from sanitised terms) plus pgvector cosine search, merged with reciprocal rank fusion. Vector search degrades silently to keyword-only.

**Passages and refs.** Chunks are shown to the model as `<passage ref="C12" source=… time=…|page=…>` in reading order. The system prompt says passage text is material, never instructions. Short refs make a hallucinated reference trivially detectable.

**Validation is code, not a model** (`study-guide/validate.ts`, `src/lib/citations/verify.ts`):
* A citation survives only if its ref was offered for that section **and** its excerpt occurs in the passage after normalising case, whitespace, quotes, dashes and speaker labels. "…" gaps are allowed if the pieces appear in order. Paraphrases fail.
* `STRICT` drops unsupported statements. `BALANCED`/`LENIENT` keep them, relabelled `@unverified`.
* External claims are dropped unless the set allows external knowledge.
* Greek symbols in the math that occur nowhere in the passages are flagged.
* Confidence is the model's estimate discounted by the verified share. Sections below 0.6 show a warning, and the guide is marked `NEEDS_REVIEW`.

**Claim markers.** Stored section text keeps `[[claim:k3]]…[[/claim]]` markers. A suffix records provenance: none = supported by source, `@inference`, `@external`, `@unverified`. The renderer turns markers into numbered chips. Each `CitationAnchor` row carries the claim key, and its time range is narrowed from the chunk to the exact transcript segments the excerpt spans (`locateInSegments`).

**Versioning and edits.** Every AI write and user edit appends an `ArtifactRevision` snapshot. A user edit sets `editedByUser`. Regenerating such a section requires `force` (API: 409 `has_user_edits`; worker: refuses).

**Auto-generation.** After the last source in a set settles, `onSourceReady` queues each requested output type that has a registered generator, but only when AI is configured.

## Security & privacy

* Auth.js v5 (credentials + optional GitHub/Google), JWT sessions; middleware guards pages, route handlers guard APIs (JSON 401s).
* Authorization via `requireStudySet(user, id, minRole)` on every route.
* Redis rate limits on study-set creation, source registration, registration (and generation/tutor endpoints later).
* Secrets only in server env (`src/lib/env.ts` is never imported by client components).
* Permanent deletion: rows deleted (cascade) and storage prefix purged by a maintenance job; audit log records it.
* Security headers in `next.config.ts`; `pino` redacts credentials.

## Phase 3: source viewer, local models, tutor

All of phase 3 runs locally:

| Capability | Service | Model |
|---|---|---|
| Speech-to-text | `stt` container (speaches / faster-whisper, CUDA, int8) | `deepdml/faster-whisper-large-v3-turbo-ct2` |
| Embeddings (semantic search) | Ollama | `embeddinggemma` (768-d, `vector(768)`) |
| Tutor chat, vision OCR fallback | Ollama | `gemma4:latest` (vision, 128K context) |
| Printed-text OCR | Tesseract CLI | — |

**Transcription.**
* Recordings are cut into ~5-minute parts at pauses: ffmpeg `silencedetect` → `planCuts`.
* Parts go through a per-worker GPU gate (`TRANSCRIPTION_CONCURRENCY=1`), on an undici agent with an explicit per-part timeout. Node fetch's built-in 5-minute header timeout previously killed long requests, and the retries piled up.
* Finished parts are checkpointed on the job, so retries resume. The language detected on the first part is reused for the rest.
* Failed sources can be retried from the UI (`POST /api/sources/:id/retry`), which carries the checkpoint over.

**Viewer.**
* `GET /api/sources/:id/media` returns short-lived signed URLs for the original file (or the extracted audio for containers browsers can't play), the normalized PDF for slides, or a YouTube id for the official embed.
* Captions are WebVTT generated from the corrected transcript.
* Deep links are `…/sources/:id?t=<s>` and `?page=<n>&anchor=<id>`.
* PDF pages render lazily with pdf.js, including a text layer. Citation regions are drawn from anchor bounding boxes, which are now line-level: document chunks store per-line boxes (`metadata.lines`) and `locateInLines` narrows each anchor to the lines its excerpt spans.
* Running headers and footers that repeat at page edges are stripped before chunking.

**Transcript corrections.**
* Edits keep `originalText` (revertible).
* Flags exclude a line from chunking.
* Each change schedules a debounced `REINDEX_SOURCE` job, which rebuilds chunks and embeddings while the source stays `READY`.
* Guide sections that cite a changed line report `sourceChanged`; they are never rewritten automatically.

**Retrieval.** `retrieveRanked` returns each hit's cosine similarity and keyword-match flag. Thresholds were calibrated with `scripts/probe-search.ts`: on-topic questions score 0.44–0.53, unrelated ones ≤ 0.27.
* Search drops semantic-only hits below 0.33.
* The tutor treats nothing ≥ 0.35 as "not in your sources".

**Tutor.**
* Each turn retrieves passages, labelled `C1…Cn` per turn. Short follow-ups such as "why?" are searched together with the previous question.
* The reply streams from Ollama over server-sent events.
* Only `[C#]` refs that were offered survive (`resolveRefs`); invented bracket labels are stripped.
* Each surviving ref is pinpointed to the transcript line or document line that the citing sentence draws on (`pinpoint`).
* Anchors are stored with `verified: false`: they are passage references, not excerpt-verified claims like the study guide's.
* When nothing matches, the reply is labelled "Not found in your sources", or "From your attached image" when an image was attached.

**OCR.** `OCR_PROVIDER=hybrid` uses Tesseract (TSV with line boxes) and falls back to Gemma 4 vision when the mean word confidence is below `OCR_MIN_CONFIDENCE` or almost no text was found. Vision transcriptions have no line boxes and log a warning to check citations against the image.
