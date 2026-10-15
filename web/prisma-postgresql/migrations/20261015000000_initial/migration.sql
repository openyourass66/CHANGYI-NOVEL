-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "NovelProject" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'zh',
    "genre" TEXT,
    "preferencesJson" TEXT NOT NULL DEFAULT '{}',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NovelProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "encoding" TEXT,
    "byteSize" INTEGER NOT NULL,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT true,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "volumeNumber" INTEGER,
    "volumeTitle" TEXT,
    "rawTitle" TEXT NOT NULL,
    "normalizedIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "splitMethod" TEXT NOT NULL DEFAULT 'auto',
    "parseConfidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "flagsJson" TEXT NOT NULL DEFAULT '[]',
    "analysisStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Chapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "apiKeyEncrypted" TEXT,
    "isLocal" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "taskUsageJson" TEXT NOT NULL DEFAULT '{}',
    "statusNote" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "inputRangeJson" TEXT NOT NULL DEFAULT '{}',
    "modelProfileId" TEXT,
    "promptVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "usageJson" TEXT NOT NULL DEFAULT '{}',
    "progressJson" TEXT NOT NULL DEFAULT '{}',
    "authorizedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryProposal" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "chapterId" TEXT,
    "draftId" TEXT,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "citationsJson" TEXT NOT NULL DEFAULT '[]',
    "targetEntryId" TEXT,
    "reason" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "sourceCitationsJson" TEXT NOT NULL DEFAULT '[]',
    "isUserEdited" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterKnowledge" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "characterName" TEXT NOT NULL,
    "infoItem" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "sourceJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterKnowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuityIssue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "description" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContinuityIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContinuationPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "summary" TEXT,
    "outlineJson" TEXT NOT NULL DEFAULT '[]',
    "relatedThreadsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContinuationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftChapter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "planId" TEXT,
    "index" INTEGER NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "outlineItemJson" TEXT NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "continuityCheckJson" TEXT NOT NULL DEFAULT '{}',
    "memoryUpdateStatus" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceCitation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "chapterId" TEXT,
    "startOffset" INTEGER,
    "endOffset" INTEGER,
    "excerpt" TEXT,
    "anchor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NovelProject_ownerId_idx" ON "NovelProject"("ownerId");

-- CreateIndex
CREATE INDEX "SourceDocument_projectId_idx" ON "SourceDocument"("projectId");

-- CreateIndex
CREATE INDEX "Chapter_projectId_sortOrder_idx" ON "Chapter"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "Chapter_sourceDocumentId_idx" ON "Chapter"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "ModelProfile_isDefault_idx" ON "ModelProfile"("isDefault");

-- CreateIndex
CREATE INDEX "AnalysisRun_projectId_status_idx" ON "AnalysisRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "MemoryProposal_projectId_state_idx" ON "MemoryProposal"("projectId", "state");

-- CreateIndex
CREATE INDEX "MemoryProposal_runId_idx" ON "MemoryProposal"("runId");

-- CreateIndex
CREATE INDEX "MemoryProposal_draftId_idx" ON "MemoryProposal"("draftId");

-- CreateIndex
CREATE INDEX "MemoryEntry_projectId_category_isCurrent_idx" ON "MemoryEntry"("projectId", "category", "isCurrent");

-- CreateIndex
CREATE INDEX "MemoryEntry_projectId_key_idx" ON "MemoryEntry"("projectId", "key");

-- CreateIndex
CREATE INDEX "CharacterKnowledge_projectId_characterName_idx" ON "CharacterKnowledge"("projectId", "characterName");

-- CreateIndex
CREATE INDEX "ContinuityIssue_projectId_status_idx" ON "ContinuityIssue"("projectId", "status");

-- CreateIndex
CREATE INDEX "ContinuityIssue_draftId_idx" ON "ContinuityIssue"("draftId");

-- CreateIndex
CREATE INDEX "ContinuationPlan_projectId_status_idx" ON "ContinuationPlan"("projectId", "status");

-- CreateIndex
CREATE INDEX "DraftChapter_projectId_index_idx" ON "DraftChapter"("projectId", "index");

-- CreateIndex
CREATE INDEX "SourceCitation_projectId_idx" ON "SourceCitation"("projectId");

-- CreateIndex
CREATE INDEX "SourceCitation_chapterId_idx" ON "SourceCitation"("chapterId");

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chapter" ADD CONSTRAINT "Chapter_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRun" ADD CONSTRAINT "AnalysisRun_modelProfileId_fkey" FOREIGN KEY ("modelProfileId") REFERENCES "ModelProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryProposal" ADD CONSTRAINT "MemoryProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryProposal" ADD CONSTRAINT "MemoryProposal_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "DraftChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterKnowledge" ADD CONSTRAINT "CharacterKnowledge_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuityIssue" ADD CONSTRAINT "ContinuityIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuityIssue" ADD CONSTRAINT "ContinuityIssue_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "DraftChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContinuationPlan" ADD CONSTRAINT "ContinuationPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftChapter" ADD CONSTRAINT "DraftChapter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftChapter" ADD CONSTRAINT "DraftChapter_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContinuationPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCitation" ADD CONSTRAINT "SourceCitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceCitation" ADD CONSTRAINT "SourceCitation_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
