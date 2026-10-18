CREATE TABLE IF NOT EXISTS NativeAutomationSettings (
 projectId TEXT PRIMARY KEY REFERENCES NovelProject(id) ON DELETE CASCADE,
 autoAccept INTEGER NOT NULL DEFAULT 1,
 autoSynthesis INTEGER NOT NULL DEFAULT 1,
 sound INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS NativeWorkflow (
 id TEXT PRIMARY KEY,
 projectId TEXT NOT NULL REFERENCES NovelProject(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'running',
 stepsJson TEXT NOT NULL,
 step INTEGER NOT NULL DEFAULT 0,
 runId TEXT,
 configJson TEXT NOT NULL,
 error TEXT,
 notified INTEGER NOT NULL DEFAULT 0,
 createdAt INTEGER NOT NULL,
 updatedAt INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS NativeWorkflow_active ON NativeWorkflow(projectId) WHERE status='running';
CREATE TABLE IF NOT EXISTS NativeTaskNotice (
 runId TEXT NOT NULL REFERENCES AnalysisRun(id) ON DELETE CASCADE,
 status TEXT NOT NULL,
 PRIMARY KEY(runId,status)
);
CREATE TABLE IF NOT EXISTS NativeGlobalAutomation (
 id INTEGER PRIMARY KEY CHECK(id=1),
 autoAccept INTEGER NOT NULL DEFAULT 1,
 autoSynthesis INTEGER NOT NULL DEFAULT 1
);
INSERT OR IGNORE INTO NativeGlobalAutomation(id,autoAccept,autoSynthesis)
 SELECT 1,COALESCE(MIN(autoAccept),1),COALESCE(MIN(autoSynthesis),1) FROM NativeAutomationSettings;
CREATE TABLE IF NOT EXISTS NativeWork (
 id TEXT PRIMARY KEY,
 workflowId TEXT NOT NULL UNIQUE,
 title TEXT NOT NULL,
 sourceProjectId TEXT REFERENCES NovelProject(id) ON DELETE SET NULL,
 sourceProjectName TEXT NOT NULL,
 direction TEXT NOT NULL,
 generatedAt INTEGER NOT NULL,
 deletedAt INTEGER
);
CREATE TABLE IF NOT EXISTS NativeWorkChapter (
 id TEXT PRIMARY KEY,
 workId TEXT NOT NULL REFERENCES NativeWork(id) ON DELETE CASCADE,
 "index" INTEGER NOT NULL,
 title TEXT,
 content TEXT NOT NULL,
 UNIQUE(workId,"index")
);
CREATE TABLE IF NOT EXISTS NativeWorkMemory (
 id TEXT PRIMARY KEY,
 workId TEXT NOT NULL REFERENCES NativeWork(id) ON DELETE CASCADE,
 chapterIndex INTEGER NOT NULL,
 sourceProposalId TEXT NOT NULL,
 payloadJson TEXT NOT NULL,
 UNIQUE(workId,sourceProposalId)
);
CREATE TABLE IF NOT EXISTS NativeWorkMerge (
 workId TEXT PRIMARY KEY REFERENCES NativeWork(id) ON DELETE CASCADE,
 projectId TEXT REFERENCES NovelProject(id) ON DELETE SET NULL,
 mergedAt INTEGER NOT NULL,
 chapterCount INTEGER NOT NULL,
 memoryAdded INTEGER NOT NULL,
 memoryConflicts INTEGER NOT NULL,
 memorySkipped INTEGER NOT NULL
);
