import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";

export const DOMAIN_MODELS = ["NovelProject", "ModelProfile", "SourceDocument", "Chapter", "ContinuationPlan", "DraftChapter", "AnalysisRun", "MemoryEntry", "CharacterKnowledge", "ContinuityIssue", "SourceCitation", "MemoryProposal"] as const;
type Row = Record<string, unknown>;
type FileRecord = { key: string; bytes: number; sha256: string };
type Delegate = {
  count(): Promise<number>;
  createMany(args: { data: Row[] }): Promise<{ count: number }>;
  findMany(args: { orderBy: { id: "asc" }; cursor?: { id: string }; skip?: number; take: number }): Promise<Row[]>;
};

function inside(root: string, key: string) {
  if (!key || key.includes("\\") || path.isAbsolute(key)) throw new Error("迁移文件路径无效。");
  const resolved = path.resolve(root, key);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("迁移文件超出指定目录。");
  return resolved;
}

async function hashFile(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function inspectLegacy(sourceDb: string, sourceFiles: string) {
  const root = await realpath(sourceFiles);
  const db = new DatabaseSync(sourceDb, { readOnly: true });
  db.exec("BEGIN");
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get();
    if (!integrity || Object.values(integrity)[0] !== "ok") throw new Error("源 SQLite 完整性检查失败。");
    if (db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("源数据库含失效关联。");
    const counts: Record<string, number> = {};
    for (const model of DOMAIN_MODELS) {
      counts[model] = Number(db.prepare(`SELECT count(*) AS count FROM "${model}"`).get()!.count);
    }
    const projects = db.prepare('SELECT id FROM "NovelProject" ORDER BY id').all().map((row) => String(row.id));
    if (projects.some((id) => !/^[a-zA-Z0-9_-]+$/.test(id))) throw new Error("源项目标识不能用于文件目录。");
    const files: FileRecord[] = [];
    async function walk(key: string) {
      const file = inside(root, key);
      const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!info) return;
      if (info.isSymbolicLink()) throw new Error("源数据含符号链接，请先核对并转换为普通文件。");
      if (info.isDirectory()) {
        for (const name of await readdir(file)) await walk(`${key}/${name}`);
      } else if (info.isFile()) {
        files.push({ key, bytes: info.size, sha256: await hashFile(file) });
      } else throw new Error("源数据含非普通文件。");
    }
    for (const id of projects) await walk(`projects/${id}`);
    const indexed = new Map(files.map((file) => [file.key, file]));
    for (const source of db.prepare('SELECT projectId, storedPath, byteSize, contentHash FROM "SourceDocument"').iterate()) {
      const key = String(source.storedPath);
      inside(root, key);
      if (!key.startsWith(`projects/${source.projectId}/`)) throw new Error("源文件元数据与项目目录不一致。");
      const file = indexed.get(key);
      if (!file || file.bytes !== source.byteSize || file.sha256 !== source.contentHash) throw new Error("源文件缺失，或字节数/哈希与数据库不一致。");
    }
    return { db, root, counts, files, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
  } catch (error) {
    db.close();
    throw error;
  }
}

function modelFields(model: string) {
  return Prisma.dmmf.datamodel.models.find((item) => item.name === model)!.fields.filter((field) => field.kind === "scalar");
}

export function convertLegacyRow(model: string, input: Row, ownerId: string, migratedAt: Date): Row {
  const row: Row = {};
  for (const field of modelFields(model)) {
    if (!(field.name in input)) continue;
    const value = input[field.name];
    if (value === null) row[field.name] = null;
    else if (field.type === "DateTime") {
      const date = value instanceof Date ? value : new Date(typeof value === "number" || typeof value === "bigint" ? Number(value) : `${value}${/Z$|[+-]\d{2}:\d{2}$/.test(String(value)) ? "" : "Z"}`);
      if (!Number.isFinite(date.getTime())) throw new Error("源数据含无效时间值。");
      row[field.name] = date;
    } else if (field.type === "Boolean") row[field.name] = Boolean(value);
    else row[field.name] = value;
  }
  if (model === "NovelProject") row.ownerId = ownerId;
  if (model === "ModelProfile") {
    row.userId = ownerId;
    row.apiKeyEncrypted = null;
    row.executionLocation = row.isLocal || ["ollama", "lmstudio"].includes(String(row.provider)) ? "device" : "server";
    row.statusNote = "迁移后请重新录入 API 密钥并测试连接。";
    row.lastCheckedAt = null;
  }
  if (model === "AnalysisRun" && ["pending", "running"].includes(String(row.status))) {
    row.status = "failed";
    row.error = "任务在数据库迁移时中断，请手动恢复或重新启动。";
    row.finishedAt = migratedAt;
  }
  return row;
}

function canonical(row: Row) {
  return JSON.stringify(Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key] instanceof Date ? row[key].toISOString() : row[key]])));
}

/** 源库只读；目标业务表必须为空。文件使用独占创建，不覆盖已有目标数据。 */
export async function transferLegacy(prisma: PrismaClient, source: Awaited<ReturnType<typeof inspectLegacy>>, ownerEmail: string, targetFiles: string, apply: boolean) {
  const user = await prisma.user.findUnique({ where: { email: ownerEmail.trim().toLowerCase() } });
  if (!user?.emailVerified) throw new Error("目标账号不存在或尚未验证邮箱。");
  const delegates = prisma as unknown as Record<string, Delegate>;
  const delegateName = (model: string) => model[0].toLowerCase() + model.slice(1);
  for (const model of DOMAIN_MODELS) {
    if (await delegates[delegateName(model)].count()) throw new Error("目标业务数据库必须为空；请使用新建环境并停止应用后迁移。");
  }
  const target = await realpath(targetFiles);
  for (const [left, right] of [[source.root, target], [target, source.root]]) {
    const relative = path.relative(left, right);
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("源文件目录与目标目录必须分离。");
  }
  for (const file of source.files) {
    if (await lstat(inside(target, file.key)).then(() => true, (error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; })) throw new Error("目标存在同名文件，迁移已停止。");
  }
  const projectsDir = path.join(target, "projects");
  const projectsInfo = await lstat(projectsDir).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (projectsInfo?.isSymbolicLink() || (projectsInfo && (await readdir(projectsDir)).length)) throw new Error("目标 projects 目录必须为空且不能是符号链接。");
  if (!apply) return { applied: false, counts: source.counts, files: source.files.length, bytes: source.totalBytes };
  const migratedAt = new Date();
  await mkdir(target, { recursive: true });
  const manifest = path.join(target, `migration-${randomUUID()}.json`);
  await writeFile(manifest, JSON.stringify({ status: "copying", ownerId: user.id, counts: source.counts, files: source.files }, null, 2), { mode: 0o600, flag: "wx" });
  for (const file of source.files) {
    const destination = inside(target, file.key);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(inside(source.root, file.key), destination, constants.COPYFILE_EXCL);
    if (await hashFile(destination) !== file.sha256) throw new Error("目标文件哈希核对失败；已复制文件保留供检查，数据库尚未提交。");
  }
  await prisma.$transaction(async (tx) => {
    const tables = tx as unknown as Record<string, Delegate>;
    for (const model of DOMAIN_MODELS) {
      const table = tables[delegateName(model)];
      if (await table.count()) throw new Error("目标数据库在迁移期间发生变化，已取消事务。");
      let rows: Row[] = [];
      const expectedHash = createHash("sha256");
      for (const input of source.db.prepare(`SELECT * FROM "${model}" ORDER BY id`).iterate()) {
        const row = convertLegacyRow(model, input, user.id, migratedAt);
        expectedHash.update(canonical(row) + "\n");
        rows.push(row);
        if (rows.length >= 100) { await table.createMany({ data: rows }); rows = []; }
      }
      if (rows.length) await table.createMany({ data: rows });
      if (await table.count() !== source.counts[model]) throw new Error("目标记录数与源数据库不一致，已取消事务。");
      const actualHash = createHash("sha256");
      let cursor: string | undefined;
      while (true) {
        const page = await table.findMany({ orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
        if (!page.length) break;
        for (const row of page) actualHash.update(canonical(row) + "\n");
        cursor = String(page.at(-1)!.id);
      }
      if (actualHash.digest("hex") !== expectedHash.digest("hex")) throw new Error("目标文本或字段哈希不一致，已取消事务。");
    }
  }, { isolationLevel: "Serializable", timeout: 30 * 60_000, maxWait: 10_000 });
  let manifestUpdated = true;
  try {
    await writeFile(manifest, JSON.stringify({ status: "completed", ownerId: user.id, counts: source.counts, files: source.files, completedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  } catch {
    // 数据库已经提交，不能把清单写入失败误报为回滚，也不能直接重跑迁移。
    manifestUpdated = false;
  }
  return { applied: true, manifestUpdated, counts: source.counts, files: source.files.length, bytes: source.totalBytes };
}
