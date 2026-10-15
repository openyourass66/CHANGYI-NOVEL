import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: [] });
try {
  if (process.env.DATABASE_PROVIDER === "postgresql") throw new Error("认领命令仅用于旧 SQLite；迁入 PostgreSQL 请使用 data:migrate。");
  const args = process.argv.slice(2);
  const email = args[args.indexOf("--email") + 1];
  if (!args.includes("--email") || !email || email.startsWith("--")) throw new Error("用法：pnpm data:claim --email 指定邮箱 [--apply]");
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user?.emailVerified) throw new Error("目标账号不存在或尚未验证邮箱。");
  // 仅 SQLite 执行的旧数据查询；不依赖 PostgreSQL 客户端中不允许 null 的归属类型。
  const [projectCount, profileCount] = await Promise.all([
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "NovelProject" WHERE "ownerId" IS NULL`,
    prisma.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "ModelProfile" WHERE "userId" IS NULL`,
  ]);
  const projects = Number(projectCount[0].count);
  const profiles = Number(profileCount[0].count);
  console.log(JSON.stringify({ mode: args.includes("--apply") ? "apply" : "dry-run", unclaimedProjects: projects, unclaimedProfiles: profiles }));
  if (args.includes("--apply")) {
    await prisma.$transaction(async (tx) => {
      const existingDefault = await tx.modelProfile.findFirst({ where: { userId: user.id, isDefault: true } });
      const updatedAt = new Date();
      await tx.$executeRaw`UPDATE "NovelProject" SET "ownerId" = ${user.id}, "updatedAt" = ${updatedAt} WHERE "ownerId" IS NULL`;
      await tx.$executeRaw`UPDATE "ModelProfile" SET "userId" = ${user.id}, "isDefault" = false, "updatedAt" = ${updatedAt} WHERE "userId" IS NULL`;
      await tx.modelProfile.updateMany({ where: { userId: user.id, isLocal: true }, data: { executionLocation: "device" } });
      if (!existingDefault) {
        const first = await tx.modelProfile.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: "desc" } });
        if (first) await tx.modelProfile.update({ where: { id: first.id }, data: { isDefault: true } });
      }
    });
    console.log("已绑定指定账号；本机模型密钥保持原加密方式，迁往 PostgreSQL 时将清空旧密文。");
  }
} catch (error) {
  console.error(error instanceof Error && !error.name.startsWith("PrismaClient") ? error.message : "认领失败；请检查数据库配置和迁移状态。");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
