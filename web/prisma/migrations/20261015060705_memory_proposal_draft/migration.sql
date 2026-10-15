-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MemoryProposal" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MemoryProposal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MemoryProposal_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "DraftChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MemoryProposal" ("category", "chapterId", "citationsJson", "content", "createdAt", "id", "key", "kind", "projectId", "reason", "runId", "state", "status", "targetEntryId", "title", "updatedAt") SELECT "category", "chapterId", "citationsJson", "content", "createdAt", "id", "key", "kind", "projectId", "reason", "runId", "state", "status", "targetEntryId", "title", "updatedAt" FROM "MemoryProposal";
DROP TABLE "MemoryProposal";
ALTER TABLE "new_MemoryProposal" RENAME TO "MemoryProposal";
CREATE INDEX "MemoryProposal_projectId_state_idx" ON "MemoryProposal"("projectId", "state");
CREATE INDEX "MemoryProposal_runId_idx" ON "MemoryProposal"("runId");
CREATE INDEX "MemoryProposal_draftId_idx" ON "MemoryProposal"("draftId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
