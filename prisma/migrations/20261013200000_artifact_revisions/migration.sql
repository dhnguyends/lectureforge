-- CreateTable
CREATE TABLE "ArtifactRevision" (
    "id" UUID NOT NULL,
    "studySetId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "origin" TEXT NOT NULL,
    "userId" UUID,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtifactRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtifactRevision_studySetId_idx" ON "ArtifactRevision"("studySetId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtifactRevision_entityType_entityId_version_key" ON "ArtifactRevision"("entityType", "entityId", "version");

