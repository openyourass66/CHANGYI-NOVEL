-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ContinuityIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "draftId" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "description" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ContinuityIssue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "NovelProject" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ContinuityIssue_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "DraftChapter" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ContinuityIssue" ("category", "createdAt", "description", "evidenceJson", "id", "projectId", "severity", "status", "updatedAt") SELECT "category", "createdAt", "description", "evidenceJson", "id", "projectId", "severity", "status", "updatedAt" FROM "ContinuityIssue";
DROP TABLE "ContinuityIssue";
ALTER TABLE "new_ContinuityIssue" RENAME TO "ContinuityIssue";
CREATE INDEX "ContinuityIssue_projectId_status_idx" ON "ContinuityIssue"("projectId", "status");
CREATE INDEX "ContinuityIssue_draftId_idx" ON "ContinuityIssue"("draftId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
