# LectureForge

Turn lecture recordings, slides, papers and notes into source-cited study material for advanced STEM courses. Every generated claim links back to the exact timestamp or page region it came from.

> **Status — phase 3 of the build.**
> - **Phase 1:** data model, auth, the Create Study Set upload workflow, the dashboard, and the source-processing pipeline (scan → audio extraction → transcription → document parsing/OCR → semantic chunking → embedding).
> - **Phase 2:** the AI provider layer (Claude via the official SDK, or OpenAI-compatible/local models), hybrid retrieval, and the **Study Guide**. Every statement in a guide is checked against the source text and linked to its timestamp or page. Sections can be edited and versioned, and regenerated one at a time.
> - **Phase 3:** all local, no API keys.
>   - **Source viewer:** video/audio player with captions and a follow-along transcript; PDF and slide viewer that boxes the cited line; image and notes viewers. Every citation has an "Open in source" link.
>   - **Transcript tools:** corrections, "inaccurate" flags (excluded from search and generation), private highlights and notes.
>   - **Semantic search** across all sources (EmbeddingGemma via Ollama).
>   - **Socratic tutor** on Gemma 4 via Ollama: cites passages down to the line, says when something isn't in your sources, has Hint / Explain differently / Show source / Challenge me / Reveal solution, and accepts image attachments and voice input.
>   - **Local speech-to-text** (Whisper large-v3-turbo on the GPU) and **hybrid OCR**: Tesseract, with Gemma 4 vision as the fallback for handwriting.
> - **Next:** flashcards, quizzes, exercises and analytics. They plug into `src/server/generation/registry.ts`.
>
> Local models: `npm run models:init` installs the Whisper model (`stt` container) and the Ollama models (`gemma4`, `embeddinggemma`). After switching embedding models, `npm run search:reindex` rebuilds the index.
>
> To enable generation, set `ANTHROPIC_API_KEY` in `.env`. Only that explicit key is used; ambient `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL` values in the environment are ignored on purpose. Without a key, `npm run db:seed` still creates a demo guide by replaying a hand-written fixture through the real validator, so the Study Guide tab can be explored offline.

- [Architecture](docs/ARCHITECTURE.md)
- [API reference](docs/API.md)

## Repository layout

```
prisma/
  schema.prisma              domain model (33 tables, pgvector)
  migrations/                initial migration + HNSW / full-text indexes
  seed.ts                    demo learner with a processed ML lecture
src/
  app/
    (auth)/                  sign-in, site access page, server actions
    (app)/dashboard/         study sets, processing jobs, review queue, progress
    (app)/study-sets/new/    Create Study Set form + uploader
    (app)/study-sets/[id]/   three-column workspace (overview + live processing)
    api/                     route handlers (thin: auth → validate → service)
  components/
    ui/                      shadcn-style primitives
    upload/                  dropzone, staging queue, presigned upload client
    jobs/ dashboard/ study-sets/ auth/
  lib/
    contracts/               Zod request/response + AI prompt contracts (shared)
    chunking/                transcript + document chunkers (pure, tested)
    uploads/                 file policy, size limits, estimates, magic-byte sniffing
    env.ts db.ts queue.ts storage.ts rate-limit.ts audit.ts …
  server/
    authz.ts                 requireUser / requireStudySet / requireSource
    services/                study sets, sources, jobs, dashboard, users
    pipeline/                ingest orchestrator, stages, purge, triggers
    providers/               transcription (OpenAI-compatible, Deepgram), embeddings, OCR, ClamAV
    generation/registry.ts   extension point for study-tool generators
  worker/index.ts            BullMQ worker process
tests/
  unit/                      vitest
  e2e/                       Playwright
```

## Local development

### Prerequisites

- Node.js 20.11+ and Docker
- On the machine running the **worker**: `ffmpeg`/`ffprobe`; LibreOffice (`soffice`, for Word .docx/.doc/.odt/.rtf and slides .pptx/.ppt/.odp; on Windows set `SOFFICE_PATH` to `soffice.com`), Tesseract + poppler (`pdftoppm`, for OCR), `yt-dlp` (YouTube import)

### Setup

```bash
npm install
```

```bash
cp .env.example .env
```

Edit `.env`: set `AUTH_SECRET` (`npx auth secret` generates one), a transcription key (`TRANSCRIPTION_API_KEY`, or `DEEPGRAM_API_KEY` with `TRANSCRIPTION_PROVIDER=deepgram`), an embeddings key, or `EMBEDDING_PROVIDER=none`, and `SEED_DEMO_PASSWORD`.

```bash
npm run infra:up
```

```bash
npm run db:deploy
```

```bash
npm run db:seed
```

Run the web app and the worker in two terminals:

```bash
npm run dev
```

```bash
npm run worker:dev
```

Open http://localhost:3000, then either sign in as `demo@lectureforge.test` (password from `SEED_DEMO_PASSWORD`) or create an account. Local object storage (SeaweedFS) serves the S3 API at http://localhost:9000; `npm run infra:up` also creates the bucket and its CORS rule (`npm run storage:init` re-applies them).

### Tests

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run test:e2e
```

### Transcription (local Whisper)

Speech-to-text runs in the `stt` container (speaches, faster-whisper, NVIDIA GPU). Install its model once with `npm run models:init`.

- **Model:** `deepdml/faster-whisper-large-v3-turbo-ct2` is multilingual, close to large-v3 in accuracy, and on a GTX 1080 Ti about 5.8× faster (5 min of French audio in 57 s, against 331 s for large-v3).
- **Parts:** recordings are cut into ~5-minute parts (`TRANSCRIPTION_CHUNK_SECONDS`) inside pauses, so words are never split. Each finished part is checkpointed, so a retry resumes where it stopped.
- **One at a time:** one part is transcribed at a time per worker (`TRANSCRIPTION_CONCURRENCY=1`). Concurrent requests on one GPU only made every upload slower. Each part has its own timeout (`TRANSCRIPTION_PART_TIMEOUT_SECONDS`), instead of Node fetch's hidden 5-minute limit.
- **Retries:** failed sources show a **Retry** button. `npm run sources:retry` retries all failed sources. `npm run sources:retry -- --stuck` also requeues sources left processing by a stopped worker; run it only while the worker is stopped.

### Schema changes

`npm run db:migrate` creates a new migration. The initial migration adds an HNSW vector index and a full-text index that Prisma cannot model. If a generated migration tries to `DROP INDEX "ExtractedChunk_embedding_hnsw_idx"` or `"ExtractedChunk_text_fts_idx"`, delete those lines before applying.

The embedding column is `vector(1536)`. To use a model with different dimensions, change the column in `schema.prisma`, write a migration, and set `EMBEDDING_DIMENSIONS` to match.

## Production

Live at https://lecture.dhnguyen68.eu (Infomaniak VPS, Docker, behind the server's shared Caddy). Images are built locally and shipped with `deploy/deploy.sh`; see [deploy/README.md](deploy/README.md) for the setup, the shared-Ollama constraints and operations. The admin page (`/admin`, password `LECTURE_ACCESS_KEY`) chooses the Claude model and effort and starts, restarts or shuts down the service; locally run it with `npm run control`.

## Principles enforced in code

- **Rights confirmation** — sources cannot be registered without `rightsConfirmed: true`. The attestation is stored on the source and in the audit log.
- **Private by default** — study sets are `PRIVATE`. Other workspace members cannot see them, and unauthorized IDs return 404.
- **Verified uploads** — size limits per type, signed Content-Type/Length, magic-byte checks after upload, and optional ClamAV scanning.
- **Permanent deletion** — deleting a source or set removes its rows by cascade and purges its storage prefix.
- **No training on user content** — `User.trainingOptIn` defaults to false and nothing in the pipeline reads content for any purpose other than the user's own workspace.
