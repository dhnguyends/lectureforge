-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('PRIVATE', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "LearnerLevel" AS ENUM ('UNDERGRADUATE', 'ADVANCED_UNDERGRADUATE', 'GRADUATE', 'RESEARCH');

-- CreateEnum
CREATE TYPE "OutputType" AS ENUM ('STUDY_GUIDE', 'FLASHCARDS', 'QUIZ', 'EXERCISES', 'AUDIO_RECAP', 'TUTOR');

-- CreateEnum
CREATE TYPE "DetailLevel" AS ENUM ('CONCISE', 'STANDARD', 'EXHAUSTIVE');

-- CreateEnum
CREATE TYPE "CitationStrictness" AS ENUM ('STRICT', 'BALANCED', 'LENIENT');

-- CreateEnum
CREATE TYPE "SourceKind" AS ENUM ('VIDEO', 'AUDIO', 'PDF', 'SLIDES', 'IMAGE', 'NOTE', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "SourceStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetRole" AS ENUM ('ORIGINAL', 'AUDIO_EXTRACT', 'AUDIO_PART', 'NORMALIZED_PDF', 'PAGE_IMAGE', 'THUMBNAIL', 'CAPTIONS');

-- CreateEnum
CREATE TYPE "ChunkKind" AS ENUM ('TRANSCRIPT', 'PAGE_TEXT', 'OCR', 'NOTE_TEXT');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('SOURCE_GROUNDED', 'INFERENCE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('SOURCE_INGEST', 'GENERATE_STUDY_GUIDE', 'GENERATE_FLASHCARDS', 'GENERATE_QUIZ', 'GENERATE_EXERCISES', 'GENERATE_AUDIO_RECAP', 'REGENERATE_ITEM', 'VALIDATE_ARTIFACT', 'PURGE_STUDY_SET', 'PURGE_SOURCE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('UPLOADING', 'SCANNING', 'EXTRACTING_AUDIO', 'TRANSCRIBING', 'PARSING_DOCUMENT', 'OCR', 'SEGMENTING', 'INDEXING', 'GENERATING', 'VALIDATING', 'COMPLETE');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "GuideStyle" AS ENUM ('EXAM_REVISION', 'DETAILED_NOTES', 'TECHNICAL_OUTLINE', 'CORNELL', 'PAPER_READING');

-- CreateEnum
CREATE TYPE "GuideSectionKind" AS ENUM ('LEARNING_OBJECTIVES', 'VOCABULARY', 'CONCEPTS', 'DEFINITIONS', 'EQUATIONS', 'ASSUMPTIONS', 'DERIVATION', 'WORKED_EXAMPLE', 'MISCONCEPTIONS', 'PREREQUISITES', 'RECALL_PROMPTS', 'NOTES');

-- CreateEnum
CREATE TYPE "FlashcardType" AS ENUM ('BASIC', 'CLOZE', 'EQUATION', 'IMAGE_LABEL', 'CODE_COMPLETION', 'CONCEPTUAL');

-- CreateEnum
CREATE TYPE "CardState" AS ENUM ('NEW', 'LEARNING', 'REVIEW', 'RELEARNING');

-- CreateEnum
CREATE TYPE "ReviewRating" AS ENUM ('AGAIN', 'HARD', 'GOOD', 'EASY');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'MULTI_SELECT', 'SHORT_ANSWER', 'ORDERING', 'MATCHING', 'DERIVATION_STEPS', 'CODE_TRACING', 'NUMERICAL');

-- CreateEnum
CREATE TYPE "ExerciseType" AS ENUM ('DERIVATION', 'QUANTITATIVE', 'PROOF', 'ALGORITHM_DESIGN', 'CODE_DEBUGGING', 'CONCEPTUAL_TRANSFER', 'PAPER_CRITIQUE');

-- CreateEnum
CREATE TYPE "ExerciseGrounding" AS ENUM ('SOURCE_GROUNDED', 'TRANSFER');

-- CreateEnum
CREATE TYPE "AttemptKind" AS ENUM ('FLASHCARD_REVIEW', 'QUIZ_QUESTION', 'EXERCISE_SUBMISSION');

-- CreateEnum
CREATE TYPE "TutorRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AnnotationKind" AS ENUM ('HIGHLIGHT', 'NOTE');

-- CreateEnum
CREATE TYPE "StudyActivity" AS ENUM ('FLASHCARD_REVIEW', 'QUIZ', 'EXERCISES', 'READ_GUIDE', 'WATCH_SOURCE', 'TUTOR');

-- CreateEnum
CREATE TYPE "MetricKind" AS ENUM ('MASTERY', 'RETENTION', 'ACCURACY', 'TIME_STUDIED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "name" TEXT,
    "image" TEXT,
    "passwordHash" TEXT,
    "trainingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "trainingOptInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletionRequested" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" UUID NOT NULL,
    "personal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'OWNER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("workspaceId","userId")
);

-- CreateTable
CREATE TABLE "StudySet" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "course" TEXT,
    "subject" TEXT,
    "description" TEXT,
    "learnerLevel" "LearnerLevel" NOT NULL DEFAULT 'ADVANCED_UNDERGRADUATE',
    "examDate" TIMESTAMP(3),
    "language" TEXT NOT NULL DEFAULT 'en',
    "visibility" "Visibility" NOT NULL DEFAULT 'PRIVATE',
    "outputTypes" "OutputType"[],
    "transcriptLanguage" TEXT,
    "speakerDiarization" BOOLEAN NOT NULL DEFAULT true,
    "preserveEquationsCode" BOOLEAN NOT NULL DEFAULT true,
    "detailLevel" "DetailLevel" NOT NULL DEFAULT 'STANDARD',
    "citationStrictness" "CitationStrictness" NOT NULL DEFAULT 'STRICT',
    "sourcesOnly" BOOLEAN NOT NULL DEFAULT true,
    "allowExternalKnowledge" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "kind" "SourceKind" NOT NULL,
    "status" "SourceStatus" NOT NULL DEFAULT 'PENDING_UPLOAD',
    "title" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "externalUrl" TEXT,
    "externalId" TEXT,
    "durationMs" INTEGER,
    "pageCount" INTEGER,
    "language" TEXT,
    "checksumSha256" TEXT,
    "rightsConfirmedAt" TIMESTAMP(3) NOT NULL,
    "rightsConfirmedBy" UUID NOT NULL,
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAsset" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "role" "AssetRole" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "page" INTEGER,
    "startMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transcript" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "language" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "diarized" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transcript_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" UUID NOT NULL,
    "transcriptId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "speaker" TEXT,
    "text" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "flaggedInaccurate" BOOLEAN NOT NULL DEFAULT false,
    "flagNote" TEXT,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedChunk" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" "ChunkKind" NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "regions" JSONB,
    "headingPath" TEXT[],
    "hasEquation" BOOLEAN NOT NULL DEFAULT false,
    "hasCode" BOOLEAN NOT NULL DEFAULT false,
    "metadata" JSONB,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationAnchor" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "chunkId" UUID,
    "transcriptSegmentId" UUID,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "page" INTEGER,
    "region" JSONB,
    "excerpt" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "supportScore" DOUBLE PRECISION,
    "claimKey" TEXT,
    "studyGuideSectionId" UUID,
    "flashcardId" UUID,
    "quizQuestionId" UUID,
    "exerciseId" UUID,
    "tutorMessageId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitationAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "transcriptSegmentId" UUID,
    "page" INTEGER,
    "region" JSONB,
    "kind" "AnnotationKind" NOT NULL,
    "body" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyGuide" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "style" "GuideStyle" NOT NULL DEFAULT 'DETAILED_NOTES',
    "status" "ArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "generationJobId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyGuide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyGuideSection" (
    "id" UUID NOT NULL,
    "guideId" UUID NOT NULL,
    "parentId" UUID,
    "order" INTEGER NOT NULL,
    "kind" "GuideSectionKind" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "claimType" "ClaimType" NOT NULL DEFAULT 'SOURCE_GROUNDED',
    "confidence" DOUBLE PRECISION,
    "warnings" TEXT[],
    "learningObjective" TEXT,
    "rationale" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyGuideSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlashcardDeck" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "scheduler" TEXT NOT NULL DEFAULT 'fsrs-5',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlashcardDeck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flashcard" (
    "id" UUID NOT NULL,
    "deckId" UUID NOT NULL,
    "guideSectionId" UUID,
    "type" "FlashcardType" NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "extra" JSONB,
    "tags" TEXT[],
    "claimType" "ClaimType" NOT NULL DEFAULT 'SOURCE_GROUNDED',
    "confidence" DOUBLE PRECISION,
    "warnings" TEXT[],
    "learningObjective" TEXT,
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flashcard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardReviewState" (
    "flashcardId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "state" "CardState" NOT NULL DEFAULT 'NEW',
    "due" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "elapsedDays" INTEGER NOT NULL DEFAULT 0,
    "scheduledDays" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),

    CONSTRAINT "CardReviewState_pkey" PRIMARY KEY ("flashcardId","userId")
);

-- CreateTable
CREATE TABLE "Quiz" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" UUID NOT NULL,
    "quizId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" JSONB,
    "answer" JSONB NOT NULL,
    "explanation" TEXT NOT NULL,
    "distractorRationale" JSONB,
    "learningObjective" TEXT NOT NULL,
    "topic" TEXT,
    "difficulty" INTEGER NOT NULL,
    "claimType" "ClaimType" NOT NULL DEFAULT 'SOURCE_GROUNDED',
    "confidence" DOUBLE PRECISION,
    "warnings" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExerciseSet" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "status" "ArtifactStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExerciseSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" UUID NOT NULL,
    "exerciseSetId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "ExerciseType" NOT NULL,
    "grounding" "ExerciseGrounding" NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "prerequisites" TEXT[],
    "assumptions" TEXT[],
    "requiredKnowledge" TEXT[],
    "expectedFormat" TEXT NOT NULL,
    "estimatedMinutes" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "learningObjective" TEXT,
    "hints" JSONB NOT NULL,
    "solution" TEXT NOT NULL,
    "verification" JSONB,
    "claimType" "ClaimType" NOT NULL DEFAULT 'SOURCE_GROUNDED',
    "confidence" DOUBLE PRECISION,
    "warnings" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "editedByUser" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "AttemptKind" NOT NULL,
    "flashcardId" UUID,
    "quizQuestionId" UUID,
    "exerciseId" UUID,
    "studySessionId" UUID,
    "rating" "ReviewRating",
    "response" JSONB,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,
    "feedback" TEXT,
    "hintsUsed" INTEGER NOT NULL DEFAULT 0,
    "solutionRevealed" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorConversation" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "focusRef" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorMessage" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "role" "TutorRole" NOT NULL,
    "content" TEXT NOT NULL,
    "action" TEXT,
    "claimType" "ClaimType",
    "confidence" DOUBLE PRECISION,
    "warnings" TEXT[],
    "attachments" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPlan" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "examDate" TIMESTAMP(3),
    "dailyMinutes" INTEGER NOT NULL DEFAULT 45,
    "preferences" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "planId" UUID,
    "activity" "StudyActivity" NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgressMetric" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "metric" "MetricKind" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "sourceId" UUID,
    "userId" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" "ProcessingStage",
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB,
    "result" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "promptVersion" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "level" "LogLevel" NOT NULL DEFAULT 'INFO',
    "stage" "ProcessingStage",
    "message" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "StudySet_workspaceId_deletedAt_updatedAt_idx" ON "StudySet"("workspaceId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "Source_studySetId_status_idx" ON "Source"("studySetId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAsset_storageKey_key" ON "SourceAsset"("storageKey");

-- CreateIndex
CREATE INDEX "SourceAsset_sourceId_role_idx" ON "SourceAsset"("sourceId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Transcript_sourceId_key" ON "Transcript"("sourceId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_transcriptId_startMs_idx" ON "TranscriptSegment"("transcriptId", "startMs");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_transcriptId_index_key" ON "TranscriptSegment"("transcriptId", "index");

-- CreateIndex
CREATE INDEX "ExtractedChunk_studySetId_idx" ON "ExtractedChunk"("studySetId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractedChunk_sourceId_index_key" ON "ExtractedChunk"("sourceId", "index");

-- CreateIndex
CREATE INDEX "CitationAnchor_sourceId_idx" ON "CitationAnchor"("sourceId");

-- CreateIndex
CREATE INDEX "CitationAnchor_studyGuideSectionId_idx" ON "CitationAnchor"("studyGuideSectionId");

-- CreateIndex
CREATE INDEX "CitationAnchor_flashcardId_idx" ON "CitationAnchor"("flashcardId");

-- CreateIndex
CREATE INDEX "CitationAnchor_quizQuestionId_idx" ON "CitationAnchor"("quizQuestionId");

-- CreateIndex
CREATE INDEX "CitationAnchor_exerciseId_idx" ON "CitationAnchor"("exerciseId");

-- CreateIndex
CREATE INDEX "CitationAnchor_tutorMessageId_idx" ON "CitationAnchor"("tutorMessageId");

-- CreateIndex
CREATE INDEX "Annotation_userId_sourceId_idx" ON "Annotation"("userId", "sourceId");

-- CreateIndex
CREATE INDEX "StudyGuide_studySetId_idx" ON "StudyGuide"("studySetId");

-- CreateIndex
CREATE INDEX "StudyGuideSection_guideId_order_idx" ON "StudyGuideSection"("guideId", "order");

-- CreateIndex
CREATE INDEX "FlashcardDeck_studySetId_idx" ON "FlashcardDeck"("studySetId");

-- CreateIndex
CREATE INDEX "Flashcard_deckId_suspended_idx" ON "Flashcard"("deckId", "suspended");

-- CreateIndex
CREATE INDEX "CardReviewState_userId_due_idx" ON "CardReviewState"("userId", "due");

-- CreateIndex
CREATE INDEX "Quiz_studySetId_idx" ON "Quiz"("studySetId");

-- CreateIndex
CREATE INDEX "QuizQuestion_quizId_order_idx" ON "QuizQuestion"("quizId", "order");

-- CreateIndex
CREATE INDEX "ExerciseSet_studySetId_idx" ON "ExerciseSet"("studySetId");

-- CreateIndex
CREATE INDEX "Exercise_exerciseSetId_order_idx" ON "Exercise"("exerciseSetId", "order");

-- CreateIndex
CREATE INDEX "Attempt_userId_createdAt_idx" ON "Attempt"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_flashcardId_idx" ON "Attempt"("flashcardId");

-- CreateIndex
CREATE INDEX "Attempt_quizQuestionId_idx" ON "Attempt"("quizQuestionId");

-- CreateIndex
CREATE INDEX "Attempt_exerciseId_idx" ON "Attempt"("exerciseId");

-- CreateIndex
CREATE INDEX "TutorConversation_studySetId_userId_updatedAt_idx" ON "TutorConversation"("studySetId", "userId", "updatedAt");

-- CreateIndex
CREATE INDEX "TutorMessage_conversationId_createdAt_idx" ON "TutorMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPlan_studySetId_userId_key" ON "StudyPlan"("studySetId", "userId");

-- CreateIndex
CREATE INDEX "StudySession_userId_scheduledFor_idx" ON "StudySession"("userId", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "ProgressMetric_userId_studySetId_scope_metric_key" ON "ProgressMetric"("userId", "studySetId", "scope", "metric");

-- CreateIndex
CREATE INDEX "GenerationJob_studySetId_queuedAt_idx" ON "GenerationJob"("studySetId", "queuedAt");

-- CreateIndex
CREATE INDEX "GenerationJob_userId_status_idx" ON "GenerationJob"("userId", "status");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_createdAt_idx" ON "JobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySet" ADD CONSTRAINT "StudySet_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySet" ADD CONSTRAINT "StudySet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Source" ADD CONSTRAINT "Source_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAsset" ADD CONSTRAINT "SourceAsset_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transcript" ADD CONSTRAINT "Transcript_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_transcriptId_fkey" FOREIGN KEY ("transcriptId") REFERENCES "Transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedChunk" ADD CONSTRAINT "ExtractedChunk_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtractedChunk" ADD CONSTRAINT "ExtractedChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ExtractedChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_transcriptSegmentId_fkey" FOREIGN KEY ("transcriptSegmentId") REFERENCES "TranscriptSegment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_studyGuideSectionId_fkey" FOREIGN KEY ("studyGuideSectionId") REFERENCES "StudyGuideSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_quizQuestionId_fkey" FOREIGN KEY ("quizQuestionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CitationAnchor" ADD CONSTRAINT "CitationAnchor_tutorMessageId_fkey" FOREIGN KEY ("tutorMessageId") REFERENCES "TutorMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_transcriptSegmentId_fkey" FOREIGN KEY ("transcriptSegmentId") REFERENCES "TranscriptSegment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGuide" ADD CONSTRAINT "StudyGuide_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGuideSection" ADD CONSTRAINT "StudyGuideSection_guideId_fkey" FOREIGN KEY ("guideId") REFERENCES "StudyGuide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGuideSection" ADD CONSTRAINT "StudyGuideSection_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "StudyGuideSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlashcardDeck" ADD CONSTRAINT "FlashcardDeck_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "FlashcardDeck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flashcard" ADD CONSTRAINT "Flashcard_guideSectionId_fkey" FOREIGN KEY ("guideSectionId") REFERENCES "StudyGuideSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardReviewState" ADD CONSTRAINT "CardReviewState_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardReviewState" ADD CONSTRAINT "CardReviewState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExerciseSet" ADD CONSTRAINT "ExerciseSet_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_exerciseSetId_fkey" FOREIGN KEY ("exerciseSetId") REFERENCES "ExerciseSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_flashcardId_fkey" FOREIGN KEY ("flashcardId") REFERENCES "Flashcard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_quizQuestionId_fkey" FOREIGN KEY ("quizQuestionId") REFERENCES "QuizQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorConversation" ADD CONSTRAINT "TutorConversation_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorConversation" ADD CONSTRAINT "TutorConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorMessage" ADD CONSTRAINT "TutorMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "TutorConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyPlan" ADD CONSTRAINT "StudyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "StudyPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressMetric" ADD CONSTRAINT "ProgressMetric_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressMetric" ADD CONSTRAINT "ProgressMetric_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_studySetId_fkey" FOREIGN KEY ("studySetId") REFERENCES "StudySet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobEvent" ADD CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written: retrieval indexes Prisma cannot express ───
-- If a later `prisma migrate dev` proposes dropping these two indexes, delete
-- those DROP INDEX lines from the generated migration before applying it.

-- Approximate nearest-neighbour search over chunk embeddings (cosine distance).
CREATE INDEX "ExtractedChunk_embedding_hnsw_idx"
  ON "ExtractedChunk" USING hnsw ("embedding" vector_cosine_ops);

-- Lexical search across all sources in a study set ("simple" config keeps
-- symbols and identifiers instead of stemming them away).
CREATE INDEX "ExtractedChunk_text_fts_idx"
  ON "ExtractedChunk" USING gin (to_tsvector('simple', "text"));
