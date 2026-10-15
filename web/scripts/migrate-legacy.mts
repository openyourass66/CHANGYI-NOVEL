import { PrismaClient } from "@prisma/client";
import { inspectLegacy, transferLegacy } from "./lib/legacy-transfer.mts";

const prisma = new PrismaClient({ log: [] });
let source: Awaited<ReturnType<typeof inspectLegacy>> | undefined;
try {
  const args = process.argv.slice(2);
  const arg = (key: string) => {
    const index = args.indexOf(key);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`缺少参数 ${key}。`);
    return args[index + 1];
  };
  if (process.env.DATABASE_PROVIDER !== "postgresql") throw new Error("请在生成 PostgreSQL 客户端的部署容器内运行迁移命令。");
  source = await inspectLegacy(arg("--source-db"), arg("--source-files"));
  const report = await transferLegacy(prisma, source, arg("--owner-email"), arg("--target-files"), args.includes("--apply"));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error instanceof Error && !error.name.startsWith("PrismaClient") ? error.message : "迁移失败；数据库事务已中止，请核对配置、源数据和目标迁移清单。");
  process.exitCode = 1;
} finally {
  source?.db.close();
  await prisma.$disconnect();
}
