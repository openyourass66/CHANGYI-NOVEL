import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { inspectLegacy, transferLegacy } from "./lib/legacy-transfer.mts";

const root = path.resolve(".verify/migration", randomUUID());
const sourceFiles = path.join(root, "source-data");
const targetFiles = path.join(root, "target-data");
await mkdir(path.join(sourceFiles, "projects", "legacy-project", "sources"), { recursive: true });
await mkdir(targetFiles, { recursive: true });
const sourcePath = path.join(root, "legacy.db");
const source = new DatabaseSync(sourcePath);
for (const name of (await readdir("prisma/migrations")).filter((name) => /^\d/.test(name) && name !== "20261015100000_auth_ownership" && name !== "20261015120000_auth_redis_otp").sort()) {
  source.exec(await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8"));
}
const content = "第一章\n私有小说正文，仅用于隔离迁移测试。";
const bytes = Buffer.from(content);
const hash = createHash("sha256").update(bytes).digest("hex");
await writeFile(path.join(sourceFiles, "projects/legacy-project/sources/original.txt"), bytes);
const now = Date.now();
source.prepare('INSERT INTO "NovelProject" (id, name, updatedAt) VALUES (?, ?, ?)').run("legacy-project", "source-project", now);
source.prepare('INSERT INTO "ModelProfile" (id, name, provider, model, apiKeyEncrypted, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run("legacy-profile", "source-model", "openai-compatible", "test-model", "old-ciphertext-must-be-cleared", now);
source.prepare('INSERT INTO "SourceDocument" (id, projectId, fileName, format, storedPath, contentHash, byteSize) VALUES (?, ?, ?, ?, ?, ?, ?)').run("legacy-source", "legacy-project", "original.txt", "txt", "projects/legacy-project/sources/original.txt", hash, bytes.length);
source.prepare('INSERT INTO "Chapter" (id, projectId, sourceDocumentId, rawTitle, normalizedIndex, content, startOffset, endOffset, sortOrder, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run("legacy-chapter", "legacy-project", "legacy-source", "第一章", 1, content, 0, content.length, 0, now);
source.prepare('INSERT INTO "AnalysisRun" (id, projectId, modelProfileId, taskType, status, updatedAt) VALUES (?, ?, ?, ?, ?, ?)').run("legacy-run", "legacy-project", "legacy-profile", "chapter-extract", "running", now);
source.close();

const targetPath = path.join(root, "target.db");
const postgres = process.env.VERIFY_DATABASE_PROVIDER === "postgresql";
const postgresURL = process.env.VERIFY_DATABASE_URL;
if (postgres) {
  assert(postgresURL && /^verify_[a-f0-9]{32}$/.test(new URL(postgresURL).searchParams.get("schema") ?? ""), "PostgreSQL 迁移验证只能使用专用隔离 schema");
  assert(process.env.VERIFY_PRISMA_SCHEMA, "PostgreSQL 验证需要限定 search_path 的隔离迁移副本");
}
if (!postgres) new DatabaseSync(targetPath).close();
const url = postgres ? postgresURL! : `file:${targetPath.replaceAll("\\", "/")}`;
try {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--schema", postgres ? process.env.VERIFY_PRISMA_SCHEMA! : "prisma/schema.prisma"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
} catch {
  throw new Error("隔离迁移测试数据库初始化失败，请检查连接、schema 与引擎兼容性。");
}
const target = new PrismaClient({ datasources: { db: { url } }, log: [] });
const snapshot = await inspectLegacy(sourcePath, sourceFiles);
try {
  const owner = await target.user.create({ data: { id: "explicit-owner", name: "owner", email: "owner@example.test", emailVerified: true } });
  const preview = await transferLegacy(target, snapshot, owner.email, targetFiles, false);
  assert.equal(preview.applied, false);
  assert.equal(await target.novelProject.count(), 0);
  await transferLegacy(target, snapshot, owner.email, targetFiles, true);
  assert.equal((await target.novelProject.findUniqueOrThrow({ where: { id: "legacy-project" } })).ownerId, owner.id);
  assert.equal((await target.modelProfile.findUniqueOrThrow({ where: { id: "legacy-profile" } })).apiKeyEncrypted, null);
  assert.equal((await target.chapter.findUniqueOrThrow({ where: { id: "legacy-chapter" } })).content, content);
  assert.equal((await target.analysisRun.findUniqueOrThrow({ where: { id: "legacy-run" } })).status, "failed");
  assert.deepEqual(await readFile(path.join(targetFiles, "projects/legacy-project/sources/original.txt")), bytes);
  assert.deepEqual(await readFile(path.join(sourceFiles, "projects/legacy-project/sources/original.txt")), bytes);
  assert.equal(snapshot.db.prepare('SELECT apiKeyEncrypted FROM "ModelProfile"').get()!.apiKeyEncrypted, "old-ciphertext-must-be-cleared");
  await assert.rejects(transferLegacy(target, snapshot, owner.email, targetFiles, true), /必须为空/);
  assert((await readdir(targetFiles)).some((name) => name.startsWith("migration-")));
} finally {
  snapshot.db.close();
  await target.$disconnect();
}
await writeFile(path.join(sourceFiles, "projects/legacy-project/sources/original.txt"), "tampered");
await assert.rejects(inspectLegacy(sourcePath, sourceFiles), /哈希/);
console.log(`PASS (${postgres ? "SQLite → PostgreSQL" : "SQLite target adapter"}): read-only legacy inspection, dry-run, explicit ownership, relation/count/content/file hashes, cleared keys, interrupted tasks, non-overwrite and tamper detection.`);
