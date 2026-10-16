import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// 生成独立 PostgreSQL 客户端，仅供类型检查，不替换本机 SQLite 客户端或连接数据库。
const root = process.cwd();
const output = path.join(root, ".verify", "postgres-types", randomUUID());
await mkdir(output, { recursive: true });
const schemaPath = path.join(output, "schema.prisma");
const schema = (await readFile("prisma-postgresql/schema.prisma", "utf8")).replace(
  'provider = "prisma-client-js"',
  'provider = "prisma-client-js"\n  output = "./client"',
);
await writeFile(schemaPath, schema);
execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--schema", schemaPath], {
  env: { ...process.env, DATABASE_URL: "postgresql://typecheck:typecheck@127.0.0.1:5432/typecheck" },
  stdio: "pipe",
});
const config = path.join(output, "tsconfig.json");
await writeFile(config, JSON.stringify({
  extends: path.join(root, "tsconfig.json"),
  compilerOptions: {
    baseUrl: root,
    paths: { "@/*": ["src/*"], "@contracts/*": ["../packages/contracts/src/*"], "@prisma/client": [path.join(output, "client")] },
    tsBuildInfoFile: path.join(output, "tsconfig.tsbuildinfo"),
  },
}, null, 2));
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--project", config], { stdio: "inherit" });
console.log("PASS: application and scripts compile against the PostgreSQL client; local SQLite client was preserved. No database connection was made.");
