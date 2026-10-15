import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

// 在目标 PostgreSQL 中仅创建/删除本次随机 schema，不读写 public 中的账号或项目。
if (process.env.DATABASE_PROVIDER !== "postgresql" || !process.env.DATABASE_URL) {
  throw new Error("请在 PostgreSQL 部署容器中运行 verify:postgres。");
}
let databaseURL: URL;
try { databaseURL = new URL(process.env.DATABASE_URL); }
catch { throw new Error("PostgreSQL 连接格式无效，请核对部署配置。"); }
if (!["postgresql:", "postgres:"].includes(databaseURL.protocol)) throw new Error("测试需要 PostgreSQL 连接。");
const admin = new PrismaClient({ log: [] });
try {
  for (const script of ["scripts/verify-auth.mts", "scripts/verify-migration.mts"]) {
    const schema = `verify_${randomUUID().replaceAll("-", "")}`;
    if (!/^verify_[a-f0-9]{32}$/.test(schema)) throw new Error("隔离 schema 标识无效。");
    let created = false;
    try {
      const isolatedPrisma = path.resolve(".verify", "postgres-runtime", schema, "prisma");
      await mkdir(path.dirname(isolatedPrisma), { recursive: true });
      await cp("prisma-postgresql", isolatedPrisma, { recursive: true });
      for (const file of await readdir(path.join(isolatedPrisma, "migrations"), { recursive: true })) {
        if (!file.endsWith("migration.sql")) continue;
        const destination = path.join(isolatedPrisma, "migrations", file);
        const sql = await readFile(destination, "utf8");
        if (/"public"\s*\.|\bSET\s+search_path\b|\b(?:DROP|ALTER)\s+(?:DATABASE|SCHEMA)\b/i.test(sql)) throw new Error("迁移包含固定 namespace 或 search_path，不能直接运行隔离测试。");
        await writeFile(destination, `SET search_path TO "${schema}";\n` + sql.replaceAll('CREATE SCHEMA IF NOT EXISTS "public";', `CREATE SCHEMA IF NOT EXISTS "${schema}";`));
      }
      await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      created = true;
      databaseURL.searchParams.set("schema", schema);
      execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", script], {
        env: { ...process.env, VERIFY_DATABASE_PROVIDER: "postgresql", VERIFY_DATABASE_URL: databaseURL.toString(), VERIFY_PRISMA_SCHEMA: path.join(isolatedPrisma, "schema.prisma") },
        stdio: "inherit",
      });
    } finally {
      if (created) {
        try { await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); }
        catch { console.error(`隔离测试 schema 清理失败，请核对临时 schema：${schema}`); throw new Error("临时 schema 清理失败。"); }
      }
    }
  }
} catch {
  console.error("PostgreSQL 隔离联调未通过；请检查上方测试结果及连接/引擎兼容性。连接凭据不会打印。");
  process.exitCode = 1;
} finally {
  await admin.$disconnect();
}
