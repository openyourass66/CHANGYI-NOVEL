const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createCipheriv, randomBytes } = require("node:crypto");
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { StorageManager, inspect } = require("./storage-manager.cjs");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "changyi-storage-"));
  const source = path.join(root, "original", "data");
  await mkdir(path.join(source, "projects", "book", "sources"), { recursive: true });
  const key = randomBytes(32).toString("hex");
  await writeFile(path.join(root, "original", ".env"), `APP_ENCRYPTION_KEY="${key}"\n`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const ct = Buffer.concat([cipher.update("test-provider-key"), cipher.final()]);
  const encrypted = JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") });
  const db = new DatabaseSync(path.join(source, "app.db"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE NovelProject(id TEXT, name TEXT);
    CREATE TABLE Chapter(id TEXT);
    CREATE TABLE ModelProfile(apiKeyEncrypted TEXT);
    CREATE TABLE SourceDocument(storedPath TEXT);
    INSERT INTO NovelProject VALUES('book', '原有小说');
    INSERT INTO Chapter VALUES('chapter');
    INSERT INTO SourceDocument VALUES('projects/book/sources/原文.txt');`);
  db.prepare("INSERT INTO ModelProfile VALUES(?)").run(encrypted);
  await writeFile(path.join(source, "projects", "book", "sources", "原文.txt"), "需要保留的小说原文");
  t.after(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
  return { root, source, key, encrypted, db, storage: new StorageManager(path.join(root, "profile"), [source]) };
}

test("迁移包含 WAL 的数据库、中文原文及模型加密配置，并保留源数据和目标无关文件", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "下载");
  await mkdir(target);
  await writeFile(path.join(target, "其他下载.txt"), "keep");
  const prepared = await f.storage.prepare(target, f.source);
  assert.equal(prepared.encryptionKey, f.key);
  assert.equal((await f.storage.config()).dataDir, undefined);
  await f.storage.save(prepared);
  assert.equal((await f.storage.config()).dataDir, target);
  assert.equal((await inspect(target)).projectCount, 1);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM NovelProject").get().n, 1);
  assert.equal(await readFile(path.join(target, "projects/book/sources/原文.txt"), "utf8"), "需要保留的小说原文");
  assert.equal(await readFile(path.join(target, "其他下载.txt"), "utf8"), "keep");
  const copy = new DatabaseSync(path.join(target, "app.db"), { readOnly: true });
  try { assert.equal(copy.prepare("SELECT apiKeyEncrypted FROM ModelProfile").get().apiKeyEncrypted, f.encrypted); }
  finally { copy.close(); }
  assert.equal((await f.storage.info()).needsSetup, false);
});

test("迁移不能覆盖目标已有工作区", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "existing");
  await mkdir(target);
  await writeFile(path.join(target, "app.db"), "existing-data");
  await assert.rejects(f.storage.prepare(target, f.source), /目标目录已有工作区文件/);
  assert.equal(await readFile(path.join(target, "app.db"), "utf8"), "existing-data");
});

test("错误加密配置或缺失原文会中止迁移，清理临时副本且不切换目录", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "target");
  await writeFile(path.join(f.root, "original", ".env"), `APP_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`);
  await assert.rejects(f.storage.prepare(target, f.source), /加密配置不匹配/);
  assert.deepEqual(await readdir(target), []);
  assert.equal((await f.storage.config()).dataDir, undefined);
  await writeFile(path.join(f.root, "original", ".env"), `APP_ENCRYPTION_KEY=${f.key}\n`);
  await rm(path.join(f.source, "projects/book/sources/原文.txt"));
  await assert.rejects(f.storage.prepare(target, f.source), /原文文件缺失/);
  assert.deepEqual(await readdir(target), []);
});

test("打开迁移后的目录可恢复密钥；后续迁移也保留数据与目录配置", async (t) => {
  const f = await fixture(t);
  const first = await f.storage.prepare(path.join(f.root, "first"), f.source);
  await f.storage.save(first);
  const second = await f.storage.prepare(path.join(f.root, "second"), first.dataDir);
  await f.storage.save(second);
  const reopened = await f.storage.prepare(second.dataDir);
  assert.equal(reopened.encryptionKey, f.key);
  assert.equal((await inspect(first.dataDir)).projectCount, 1);
  assert.equal((await inspect(second.dataDir)).chapterCount, 1);
});

test("用户配置写入中断时可从上一份有效配置恢复数据位置和密钥", async (t) => {
  const f = await fixture(t);
  const config = await f.storage.prepare(path.join(f.root, "workspace"), f.source);
  await f.storage.save(config);
  await writeFile(`${f.storage.configFile}.previous`, await readFile(f.storage.configFile));
  await writeFile(f.storage.configFile, '{"dataDir":');
  assert.deepEqual(await f.storage.config(), config);
});
