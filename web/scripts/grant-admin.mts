import { prisma } from "../src/lib/db.ts";

const email = process.argv[2]?.trim().toLowerCase();
const role = process.argv[3] ?? "super_admin";
if (!email || !["super_admin", "operator", "observer"].includes(role)) {
  console.error("用法: pnpm admin:grant <已验证邮箱> [super_admin|operator|observer]");
  process.exitCode = 2;
} else {
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, emailVerified: true, disabledAt: true } });
    if (!user || !user.emailVerified || user.disabledAt) throw new Error("账号不存在、邮箱未验证或账号已停用。");
    const previousRole = await prisma.$transaction(async (tx) => {
      const existing = await tx.adminIdentity.findUnique({ where: { userId: user.id }, select: { role: true } });
      if (existing?.role === role) return existing.role;
      await tx.adminIdentity.upsert({ where: { userId: user.id }, create: { userId: user.id, role }, update: { role } });
      await tx.adminAuditLog.create({ data: {
        actorId: user.id, action: existing ? "admin.role_changed" : "admin.role_granted", targetType: "admin", targetId: user.id,
        detailJson: JSON.stringify({ previousRole: existing?.role ?? null, role }),
      } });
      return existing?.role ?? null;
    });
    console.log(previousRole === role ? `${email} 已具有角色 ${role}。` : `已授予 ${email} 管理员角色 ${role}，变更已写入审计日志。`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "无法授予管理员角色。");
    process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}
