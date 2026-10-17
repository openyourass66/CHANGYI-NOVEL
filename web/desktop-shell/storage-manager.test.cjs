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
  return { root, source, key, encrypted, db, storage: new StorageManager(path.join(root, "profile")) };
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

test("首次只选择空目录时创建新工作区，不自动导入其他目录的数据", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "new-workspace");
  const config = await f.storage.prepareDestination(target);
  assert.equal(config.dataDir, target);
  assert.match(config.encryptionKey, /^[a-f\d]{64}$/);
  assert.deepEqual(await readdir(target), [".changyi-storage.json"]);
  assert.equal((await f.storage.info()).needsSetup, true);
  await f.storage.save(config);
  assert.equal((await f.storage.info()).needsSetup, false);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM NovelProject").get().n, 1);
});

test("更换到空目录时自动复制当前项目、原文和密钥，保留源数据与目标无关文件", async (t) => {
  const f = await fixture(t);
  await f.storage.save(await f.storage.prepareDestination(f.source));
  const target = path.join(f.root, "new-location");
  await mkdir(target);
  await writeFile(path.join(target, "其他文件.txt"), "keep");
  const config = await f.storage.prepareDestination(target);
  assert.equal(config.encryptionKey, f.key);
  assert.equal((await inspect(target)).projectCount, 1);
  assert.equal(await readFile(path.join(target, "projects/book/sources/原文.txt"), "utf8"), "需要保留的小说原文");
  assert.equal(await readFile(path.join(target, "其他文件.txt"), "utf8"), "keep");
  assert.equal(f.db.prepare("SELECT apiKeyEncrypted FROM ModelProfile").get().apiKeyEncrypted, f.encrypted);
  assert.equal((await f.storage.config()).dataDir, f.source);
  await f.storage.save(config);
  assert.equal((await f.storage.info()).dataDir, target);
});

test("选择已有工作区时使用目标自己的项目和密钥，不用当前数据覆盖它", async (t) => {
  const f = await fixture(t);
  const other = await fixture(t);
  other.db.exec("UPDATE NovelProject SET name = '目标小说'");
  await f.storage.save(await f.storage.prepareDestination(f.source));
  const config = await f.storage.prepareDestination(other.source);
  assert.equal(config.dataDir, other.source);
  assert.equal(config.encryptionKey, other.key);
  assert.equal(other.db.prepare("SELECT name FROM NovelProject").get().name, "目标小说");
  assert.equal(other.db.prepare("SELECT apiKeyEncrypted FROM ModelProfile").get().apiKeyEncrypted, other.encrypted);
  assert.equal(f.db.prepare("SELECT name FROM NovelProject").get().name, "原有小说");
  const reopened = await f.storage.prepareDestination(f.source);
  assert.equal(reopened.encryptionKey, f.key);
});

test("拒绝相对目录、不完整工作区和嵌套迁移，保持当前配置及文件不变", async (t) => {
  const f = await fixture(t);
  const previous = await f.storage.prepareDestination(f.source);
  await f.storage.save(previous);
  await assert.rejects(f.storage.prepareDestination("relative-path"), /先选择/);
  const target = path.join(f.root, "partial");
  await mkdir(path.join(target, "projects"), { recursive: true });
  await writeFile(path.join(target, "projects", "原有文件.txt"), "keep");
  await assert.rejects(f.storage.prepareDestination(target), /不完整的工作区/);
  assert.equal(await readFile(path.join(target, "projects", "原有文件.txt"), "utf8"), "keep");
  await assert.rejects(f.storage.prepareDestination(path.join(f.source, "nested")), /不能互相包含/);
  assert.deepEqual(await f.storage.config(), previous);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM NovelProject").get().n, 1);
});

test("当前配置的目录丢失时不创建空工作区，也不丢弃原配置", async (t) => {
  const f = await fixture(t);
  const previous = { dataDir: path.join(f.root, "missing"), encryptionKey: f.key };
  await f.storage.save(previous);
  const target = path.join(f.root, "target");
  await assert.rejects(f.storage.prepareDestination(target), /当前数据目录不可用/);
  assert.deepEqual(await f.storage.config(), previous);
});
