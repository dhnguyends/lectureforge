# API reference (phase 1)

All endpoints require a signed-in session unless noted. Request and response bodies are JSON and are defined as Zod schemas in `src/lib/contracts/`, the single source of truth shared by client and server.

Errors always have this shape:

```json
{ "error": { "code": "validation_error", "message": "Invalid request.", "details": [...], "requestId": "uuid" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` / `bad_request` | Schema failure or business-rule violation (unsupported type, too large, content mismatch) |
| 401 | `unauthorized` | No session |
| 403 | `forbidden` | Can see the set but role is too low (e.g. VIEWER deleting) |
| 404 | `not_found` | Missing **or** not yours |
| 409 | `conflict` | Duplicate email, source already processed |
| 429 | `rate_limited` | `Retry-After` header set |

## Accounts

### `POST /api/account/register` (public)
`{ name, email, password }` → `201 { id }`. Rate-limited per IP.

## Study sets

### `GET /api/study-sets`
→ `{ studySets: StudySetSummary[] }` — includes source counts by status and due-card count for the caller.

### `POST /api/study-sets`
```json
{
  "title": "Lecture 7 — Backpropagation",
  "course": "CS 7643", "subject": "Deep learning",
  "learnerLevel": "GRADUATE",            // UNDERGRADUATE | ADVANCED_UNDERGRADUATE | GRADUATE | RESEARCH
  "examDate": "2026-12-14",
  "language": "en",
  "outputTypes": ["STUDY_GUIDE", "FLASHCARDS", "QUIZ", "EXERCISES"],
  "advanced": {
    "transcriptLanguage": null,          // null = auto-detect
    "speakerDiarization": true,
    "preserveEquationsCode": true,
    "detailLevel": "STANDARD",           // CONCISE | STANDARD | EXHAUSTIVE
    "citationStrictness": "STRICT",      // STRICT | BALANCED | LENIENT
    "sourcesOnly": true,
    "allowExternalKnowledge": false      // cannot be true while sourcesOnly is true
  }
}
```
→ `201 { id }`

### `GET /api/study-sets/:id`
→ set details plus the caller's `role`.

### `DELETE /api/study-sets/:id` (OWNER)
→ `204`. Hidden immediately; rows and stored files purged by a background job.

### `GET /api/study-sets/:id/status`
→ `StudySetStatusResponse`: each source with `status`, current job `stage`/`progress`, and the latest 8 job events. `active: true` while anything is in flight.

## Sources

### `POST /api/study-sets/:id/sources` (EDITOR)
File upload:
```json
{ "type": "upload", "filename": "lecture07.mp4", "mimeType": "video/mp4", "sizeBytes": 734003200, "durationMs": 5412000, "rightsConfirmed": true }
```
YouTube (only if enabled on the server):
```json
{ "type": "youtube", "url": "https://www.youtube.com/watch?v=…", "rightsConfirmed": true }
```
→ `201`
```json
{
  "sourceId": "uuid",
  "kind": "VIDEO",
  "estimate": { "minSeconds": 320, "maxSeconds": 1180 },
  "upload": { "url": "https://…signed…", "method": "PUT", "headers": { "Content-Type": "video/mp4" }, "expiresIn": 3600 }
}
```
`rightsConfirmed` must be the literal `true`.

### `POST /api/sources/:id/complete` (EDITOR)
Call after the PUT succeeds. Verifies size and content signature, then queues processing.
→ `{ sourceId, jobId }` (idempotent).

### `DELETE /api/sources/:id` (EDITOR)
→ `204`. Permanently deletes the source, its transcript, chunks and stored files.

## Jobs

### `GET /api/jobs`
→ `{ jobs: ActiveJob[] }` — the caller's queued/running jobs and those finished in the last 24 h.

## Upload limits

| Kind | Extensions | Max |
|---|---|---|
| Video | mp4 m4v mov webm mkv | 4 GB |
| Audio | mp3 m4a wav flac ogg oga opus aac | 1 GB |
| PDF | pdf | 200 MB |
| Slides | pptx ppt odp | 200 MB |
| Word document | docx doc odt rtf | 100 MB |
| Image | png jpg jpeg webp | 25 MB |
| Notes | md markdown txt tex | 5 MB |

Up to 50 sources per study set.

## Study guides (phase 2)

### `GET /api/study-sets/:id/study-guides`
→ `{ guides: [{ id, title, style, status, createdAt }], activeJobs: JobView[], readySources, aiConfigured }`. Polled while a job is active.

### `POST /api/study-sets/:id/study-guides` (EDITOR)
`{ style: "DETAILED_NOTES" | "EXAM_REVISION" | "TECHNICAL_OUTLINE" | "CORNELL" | "PAPER_READING" }` → `202 { jobId }`.
Creates a new guide version; earlier versions are kept. `400` if AI is not configured or no source is ready, `409` if a guide is already generating. Rate-limited.

### `GET /api/study-guides/:guideId`
→ `GuideView`: sections in order, each with `content` (Markdown + KaTeX + claim markers), `claimType`, `confidence`, `warnings`, `version`, `editedByUser`, and `anchors[]`. Each anchor has `{ claimKey, sourceTitle, sourceKind, startMs, endMs, page, excerpt, verified }`.

### `DELETE /api/study-guides/:guideId` (EDITOR) → `204`

### `PATCH /api/study-guide-sections/:sectionId` (EDITOR)
`{ content, title? }` → saves a new version and marks it edited by the user. `400` if claim markers are unbalanced.

### `POST /api/study-guide-sections/:sectionId/regenerate` (EDITOR)
`{ instructions?, force? }` → `202 { jobId }`. Regenerates only this section with the same citation checks. `409 has_user_edits` unless `force: true` when the section has user edits.

### Claim markers in `content`
`[[claim:k3]]statement[[/claim]]`, with optional provenance suffix `@inference`, `@external`, `@unverified`. No suffix means the statement is supported by a verified excerpt; its anchors share the `claimKey`.

## Source viewer, search and tutor (phase 3)

| Method & path | Role | Purpose |
|---|---|---|
| `GET /api/sources/:id/media` | VIEWER | Signed URLs (1 h) for playback/viewing; `youtubeId` for YouTube sources |
| `GET /api/sources/:id/captions` | VIEWER | WebVTT captions from the corrected transcript |
| `GET /api/sources/:id/transcript` | VIEWER | Segments with `edited`, `originalText`, `flaggedInaccurate`, `flagNote` |
| `PATCH /api/transcript-segments/:id` | EDITOR | `{ text? \| revert: true \| flaggedInaccurate?, flagNote? }`; schedules a re-index |
| `GET/POST /api/sources/:id/annotations` | VIEWER | The caller's private highlights/notes (`{ kind, transcriptSegmentId? \| page+region?, body?, color? }`) |
| `PATCH/DELETE /api/annotations/:id` | author | Edit or delete own annotation |
| `GET /api/sources/:id/citations` | VIEWER | Study-guide anchors on this source, with section titles |
| `POST /api/sources/:id/retry` | EDITOR | Re-run processing of a failed source; resumes finished transcription parts |
| `GET /api/study-sets/:id/search?q=` | VIEWER | Hybrid search; each result has a snippet with highlight ranges, `match: keyword\|semantic\|both`, and a deep link |
| `GET/POST /api/study-sets/:id/tutor/conversations` | VIEWER | List / create the caller's private conversations |
| `GET/DELETE /api/study-sets/:id/tutor/conversations/:cid` | owner | Messages with anchors (`ref`, location, excerpt) |
| `POST /api/study-sets/:id/tutor/conversations/:cid/messages` | owner | Multipart `text`, `action` (`hint`, `explain_differently`, `show_source`, `challenge`, `reveal_solution`), optional `image` (PNG/JPEG/WebP ≤ 8 MB). Streams `text/event-stream` events: `user` → `sources` (`noSourceMatch`, `fromImageOnly`) → `delta`… → `done` / `error` |
| `POST /api/speech-to-text` | user | Multipart `audio` (webm/ogg/m4a/wav/mp3 ≤ 20 MB) → `{ text }` for voice input |

## Flashcards (phase 4)

Cards are generated by Claude from the study set's passages in batches, then
validated like study-guide claims: each citation must be a verbatim excerpt of
an offered passage, unsupported cards are dropped (STRICT) or flagged, and
near-duplicates (also against earlier decks) are skipped. Each generation
creates a new deck. Scheduling is FSRS-5 (`src/lib/srs/fsrs.ts`), per learner.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/study-sets/:id/flashcards` | Decks, counts (due, new today, learned, total), active jobs |
| POST | `/api/study-sets/:id/flashcards` | `{ count?: 5–200, focus?: string }` → 202 `{ jobId }` (EDITOR) |
| GET | `/api/study-sets/:id/flashcards/review` | Review queue: due cards (oldest first), then new cards up to 20/day; each with interval previews per answer |
| GET | `/api/study-sets/:id/flashcards/cards?deckId=` | All cards with citations and this learner's schedule |
| POST | `/api/flashcards/:cardId/review` | `{ rating: "AGAIN"\|"HARD"\|"GOOD"\|"EASY", durationMs? }` → new state and due date; records an Attempt |
| PATCH | `/api/flashcards/:cardId` | `{ front?, back?, suspended? }` (EDITOR); editing keeps the schedule |
| DELETE | `/api/flashcards/:cardId` | (EDITOR) |
| DELETE | `/api/flashcard-decks/:deckId` | Deletes the deck and its cards (EDITOR) |

Card types: BASIC, CLOZE (`{{c1::hidden}}` in the front), EQUATION, CONCEPTUAL,
CODE_COMPLETION. "Again" brings a card back after 10 minutes; other answers
schedule whole days.

## Quizzes (phase 4)

Questions are generated by Claude in batches from the study set's passages,
then validated: citations must be verbatim excerpts, malformed questions
(bad ids, duplicate options, missing answers, absurd tolerances) and
near-duplicates are removed, and choice options are shuffled and relabelled.
Answers are stored server-side and only returned after the learner answers.
Each attempt is a `StudySession` (activity QUIZ) whose answers are `Attempt`s.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/study-sets/:id/quizzes` | Quizzes with this learner's last/best score, active jobs |
| POST | `/api/study-sets/:id/quizzes` | `{ count: 3–40 (10), difficulty: "foundational"\|"mixed"\|"challenging", types?: QuestionType[], focus? }` → 202 `{ jobId }` (EDITOR) |
| GET | `/api/quizzes/:quizId` | Questions without answers, plus the unfinished attempt (with results so far) |
| DELETE | `/api/quizzes/:quizId` | (EDITOR) |
| POST | `/api/quizzes/:quizId/sessions` | Starts an attempt → `{ sessionId }` |
| POST | `/api/quiz-questions/:questionId/answer` | `{ sessionId, response, durationMs? }` → grade, correct answer, explanation, why each wrong option is wrong, citations. Idempotent per attempt |
| POST | `/api/quiz-sessions/:sessionId/finish` | Score, correct/answered, time, breakdown by topic |

Question types and `response` shapes: MULTIPLE_CHOICE `{kind:"single",choice}`,
MULTI_SELECT `{kind:"multi",choices}` (partial credit), SHORT_ANSWER
`{kind:"text",text}` (exact-form match, otherwise graded by the AI model),
NUMERICAL `{kind:"numerical",value}` (string; "0,25", "2.5e-1", "25%" accepted;
within tolerance), ORDERING `{kind:"ordering",order}` and MATCHING
`{kind:"matching",pairs}` (positional / per-pair credit).

## Administration (server-to-server)

Called only by the control service (`control/server.mjs`) after the admin
signs in; authorized by `X-Admin-Token` = HMAC-SHA256(LECTURE_ACCESS_KEY,
"lectureforge-admin-api/v1"). Browser sessions cannot use them.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/users` | Accounts with profile and study-set count |
| POST | `/api/admin/users` | `{ name, email, password (≥10), profileId }` |
| PATCH | `/api/admin/users/:userId` | `{ profileId }` |
| DELETE | `/api/admin/users/:userId` | Deletes the account, its study sets and stored files; open sessions lose access |
| GET / POST | `/api/admin/profiles` | List (with disciplines, account counts) / create `{ name, anyDiscipline }` |
| DELETE | `/api/admin/profiles/:profileId` | Only when no account uses it (409 otherwise) |
| POST | `/api/admin/profiles/:profileId/disciplines` | `{ name }` (409 if already there) |
| DELETE | `/api/admin/disciplines/:disciplineId` | Existing study sets keep their discipline |

Study-set creation (`POST /api/study-sets`) checks `subject` against the
user's profile: one of its disciplines (case-insensitive), or anything for a
profile with `anyDiscipline` (400 otherwise).

## Exercises (phase 4)

A set has easy (difficulty 1–2, ~5–15 min), intermediate (3, ~15–30 min) and
difficult (4–5, ~30–60 min) exercises — 5 / 5 / 2 by default. Claude writes
each tier in parallel from the study set's passages; exercise types follow the
creator's profile (Business School: case analysis, calculation, concept
transfer; Engineering: derivation, calculation, algorithm design, debugging,
proof; Research: all, incl. paper critique). Each exercise has a statement,
prerequisites, assumptions, expected format, 2–4 progressive hints, a worked
solution, a grading rubric and, for calculations, a final number with a
tolerance. Citations are verified like other materials; malformed and
duplicate exercises are removed; every final number is re-computed by an
independent pass and disagreements are flagged.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/study-sets/:id/exercises` | Sets with counts per tier and this learner's progress |
| POST | `/api/study-sets/:id/exercises` | `{ easy: 0–10 (5), intermediate: 0–10 (5), difficult: 0–10 (2), focus? }` → 202 `{ jobId }` (EDITOR) |
| GET | `/api/exercise-sets/:setId` | Exercises without hints/solutions (only those already opened), with this learner's attempts |
| DELETE | `/api/exercise-sets/:setId` | (EDITOR) |
| POST | `/api/exercises/:id/hint` | `{ index }` → the next hint |
| POST | `/api/exercises/:id/submit` | `{ text, finalAnswer?, hintsUsed, durationMs? }` → AI grading against the rubric: score, verdict, strengths, gaps, misconceptions, feedback, next step, final-number check. Resubmission allowed |
| POST | `/api/exercises/:id/solution` | `{ hintsUsed }` → worked solution, rubric, final answer, independent-check status, citations (recorded) |
