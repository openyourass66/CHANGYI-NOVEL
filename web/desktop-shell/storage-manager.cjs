const { DatabaseSync } = require("node:sqlite");
const { randomBytes, randomUUID, createDecipheriv } = require("node:crypto");
const { access, copyFile, cp, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } = require("node:fs/promises");
const path = require("node:path");

const STORAGE_FILE = ".changyi-storage.json";
const validKey = (key) => typeof key === "string" && /^[a-f\d]{64}$/i.test(key);
async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) {
      try { return JSON.parse(await readFile(`${file}.previous`, "utf8")); }
      catch (recoveryError) { if (recoveryError.code !== "ENOENT") throw recoveryError; }
    }
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    try { await rename(temporary, file); }
    catch (error) {
      if (error.code !== "EXDEV") throw error;
      // Windows EFS can reject replacing an encrypted file by rename even in
      // the same folder. Keep a recovery copy before updating it in place.
      let backedUp = false;
      try { await copyFile(file, `${file}.previous`); backedUp = true; }
      catch (backupError) { if (backupError.code !== "ENOENT") throw backupError; }
      try { await writeFile(file, await readFile(temporary)); }
      catch (writeError) { if (backedUp) await copyFile(`${file}.previous`, file); throw writeError; }
    }
  } finally { await rm(temporary, { force: true }); }
}
async function inspect(directory) {
  const file = path.join(directory, "app.db");
  try { if ((await stat(file)).size === 0) return null; }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const count = (table) => Number(db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n);
    return {
      directory, projectCount: count("NovelProject"), chapterCount: count("Chapter"), profileCount: count("ModelProfile"),
    };
  } finally { db.close(); }
}
async function encryptionKey(directory, fallback) {
  const metadata = await readJson(path.join(directory, STORAGE_FILE));
  if (metadata) {
    if (!validKey(metadata.encryptionKey)) throw new Error("数据目录中的加密配置无效，请从备份恢复该配置文件。");
    return metadata.encryptionKey;
  }
  let key = fallback;
  // The original monolith keeps .env beside data/, not inside the data folder.
  for (const base of [path.dirname(directory), directory]) {
    for (const name of [".env", ".env.local"]) {
      try {
        const text = await readFile(path.join(base, name), "utf8");
        const match = text.match(/^\s*(?:export\s+)?APP_ENCRYPTION_KEY\s*=\s*["']?([a-f\d]{64})["']?\s*(?:#.*)?$/im);
        if (match) key = match[1];
      } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
  }
  return key;
}
function validateSecrets(db, key) {
  const secrets = db.prepare('SELECT "apiKeyEncrypted" FROM "ModelProfile" WHERE "apiKeyEncrypted" IS NOT NULL').all();
  if (secrets.length && !validKey(key)) throw new Error("旧目录包含已加密的模型密钥，请将原项目 .env 放在数据目录的上一级后重试。");
  for (const row of secrets) {
    try {
      const p = JSON.parse(row.apiKeyEncrypted);
      if (p.v !== 1) throw new Error("unsupported version");
      const cipher = createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(p.iv, "base64"));
      cipher.setAuthTag(Buffer.from(p.tag, "base64"));
      cipher.update(Buffer.from(p.ct, "base64"));
      cipher.final();
    } catch { throw new Error("原模型密钥与加密配置不匹配，请使用原项目的 .env 或原目录的加密配置。"); }
  }
}
async function validateFiles(directory) {
  const db = new DatabaseSync(path.join(directory, "app.db"), { readOnly: true });
  try {
    for (const row of db.prepare('SELECT "storedPath" FROM "SourceDocument"').all()) {
      const file = path.resolve(directory, row.storedPath);
      const relative = path.relative(directory, file);
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("原文路径超出数据目录，无法迁移。");
      try { await access(file); } catch { throw new Error(`原文文件缺失：${row.storedPath}`); }
    }
  } finally { db.close(); }
}
function nested(a, b) {
  const relative = path.relative(a, b);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

class StorageManager {
  constructor(userDirectory) {
    this.userDirectory = userDirectory;
    this.configFile = path.join(userDirectory, "app-config.json");
  }
  async config() {
    const config = await readJson(this.configFile) ?? {};
    if (config.encryptionKey && !validKey(config.encryptionKey)) throw new Error("应用加密配置无效。");
    return config;
  }
  async save(config) { await atomicJson(this.configFile, config); }
  async info() {
    const config = await this.config();
    const current = config.dataDir ?? path.join(this.userDirectory, "data");
    return { dataDir: current, needsSetup: !config.dataDir };
  }
  async prepareDestination(directory) {
    if (!path.isAbsolute(directory)) throw new Error("请先选择数据保存文件夹。");
    // An existing workspace keeps its own projects and encryption configuration.
    if (await inspect(directory)) return this.prepare(directory);
    let entries;
    try { entries = await readdir(directory); }
    catch (error) { if (error.code !== "ENOENT") throw error; entries = []; }
    if (entries.some((name) => ["app.db", "app.db-wal", "app.db-shm", "projects", STORAGE_FILE].includes(name))) {
      throw new Error("所选文件夹包含不完整的工作区数据，请选择其他文件夹。");
    }
    const previous = await this.config();
    const current = previous.dataDir ?? path.join(this.userDirectory, "data");
    if (await inspect(current)) return this.prepare(directory, current);
    if (previous.dataDir) throw new Error("当前数据目录不可用，请选择已有工作区文件夹，或恢复原目录后重试。");
    return this.prepare(directory);
  }
  async prepare(directory, sourceDirectory) {
    if (!path.isAbsolute(directory)) throw new Error("请选择完整的数据目录路径。");
    await mkdir(directory, { recursive: true });
    const target = await realpath(directory);
    const previous = await this.config();
    const oldDirectory = previous.dataDir ?? path.join(this.userDirectory, "data");
    const source = sourceDirectory ? await realpath(sourceDirectory) : null;
    if (!source || source.toLowerCase() === target.toLowerCase()) {
      const summary = await inspect(target);
      let key = await encryptionKey(target, target.toLowerCase() === path.resolve(oldDirectory).toLowerCase() ? previous.encryptionKey : undefined);
      if (summary) {
        const db = new DatabaseSync(path.join(target, "app.db"), { readOnly: true });
        try { validateSecrets(db, key); } finally { db.close(); }
        await validateFiles(target);
      }
      key ??= randomBytes(32).toString("hex");
      await atomicJson(path.join(target, STORAGE_FILE), { version: 1, encryptionKey: key });
      return { dataDir: target, encryptionKey: key };
    }
    if (nested(source, target) || nested(target, source)) throw new Error("保存目录与原目录不能互相包含，请选择另一个文件夹。");
    const summary = await inspect(source);
    if (!summary) throw new Error("所选原目录中没有可用的长忆数据库。");
    for (const name of ["app.db", "app.db-wal", "app.db-shm", "projects", STORAGE_FILE]) {
      if ((await readdir(target)).includes(name)) throw new Error("目标目录已有工作区文件，请选择空目录，或直接打开已有数据目录。");
    }
    const key = await encryptionKey(source, source.toLowerCase() === path.resolve(oldDirectory).toLowerCase() ? previous.encryptionKey : undefined);
    const staging = path.join(target, `.changyi-import-${randomUUID()}`);
    await mkdir(staging);
    const committed = [];
    try {
      const db = new DatabaseSync(path.join(source, "app.db"), { readOnly: true });
      try {
        validateSecrets(db, key);
        db.exec(`VACUUM INTO '${path.join(staging, "app.db").replaceAll("'", "''")}'`);
      } finally { db.close(); }
      try { await cp(path.join(source, "projects"), path.join(staging, "projects"), { recursive: true, dereference: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await validateFiles(staging);
      const result = { dataDir: target, encryptionKey: key ?? randomBytes(32).toString("hex") };
      await atomicJson(path.join(staging, STORAGE_FILE), { version: 1, encryptionKey: result.encryptionKey });
      for (const name of await readdir(staging)) {
        // Never replace a target that appeared while the snapshot was being copied.
        try { await access(path.join(target, name)); throw new Error("目标目录内容已变化，请重试。"); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        await rename(path.join(staging, name), path.join(target, name));
        committed.push(name);
      }
      return result;
    } catch (error) {
      for (const name of committed.reverse()) await rename(path.join(target, name), path.join(staging, name));
      throw error;
    } finally {
      // staging is freshly created inside the selected folder and contains only our snapshot.
      await rm(staging, { recursive: true, force: true });
    }
  }
}

module.exports = { StorageManager, inspect };
