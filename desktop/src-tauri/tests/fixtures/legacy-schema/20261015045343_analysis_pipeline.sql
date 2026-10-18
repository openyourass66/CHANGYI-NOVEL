/*
  Warnings:

  - Added the required column `updatedAt` to the `AnalysisRun` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "MemoryProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "runId" TEXT,
    "chapterId" TEXT,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "inputRangeJson" TEXT NOT NULL DEFAULT '{}',
    "modelProfileId" TEXT,
    "promptVersion" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "usageJson" TEXT NOT NULL DEFAULT '{}',
    "progressJson" TEXT NOT NULL DEFAULT '{}',
    "authorizedAt" DATETIME,
    "canceledAt" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AnalysisRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AnalysisRun_modelProfileId_fkey" FOREIGN KEY ("modelProfileId") REFERENCES "ModelProfile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AnalysisRun" ("createdAt", "error", "finishedAt", "id", "inputRangeJson", "modelProfileId", "projectId", "promptVersion", "startedAt", "status", "taskType", "usageJson") SELECT "createdAt", "error", "finishedAt", "id", "inputRangeJson", "modelProfileId", "projectId", "promptVersion", "startedAt", "status", "taskType", "usageJson" FROM "AnalysisRun";
DROP TABLE "AnalysisRun";
ALTER TABLE "new_AnalysisRun" RENAME TO "AnalysisRun";
CREATE INDEX "AnalysisRun_projectId_status_idx" ON "AnalysisRun"("projectId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MemoryProposal_projectId_state_idx" ON "MemoryProposal"("projectId", "state");

-- CreateIndex
CREATE INDEX "MemoryProposal_runId_idx" ON "MemoryProposal"("runId");
