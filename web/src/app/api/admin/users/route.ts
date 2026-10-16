import { prisma } from "@/lib/db";
import { adminError, adminOptions, requireAdmin, verifyAdminMutationOrigin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export function OPTIONS() { return adminOptions(); }

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1));
    const where = q ? { OR: [{ email: { contains: q } }, { name: { contains: q } }] } : {};
    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, skip: (page - 1) * 25, take: 25, orderBy: { createdAt: "desc" }, select: {
        id: true, name: true, email: true, emailVerified: true, disabledAt: true, createdAt: true,
        adminIdentity: { select: { role: true } }, _count: { select: { projects: true } },
      } }),
    ]);
    return Response.json({ users: rows.map(({ adminIdentity, _count, ...user }) => ({ ...user, projectCount: _count.projects, role: adminIdentity?.role ?? null })), total, page, pageSize: 25 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}

export async function PATCH(request: Request) {
  try {
    verifyAdminMutationOrigin(request);
    const { user: actor } = await requireAdmin(request, true);
    const body = await request.json().catch(() => ({})) as { userId?: unknown; disabled?: unknown; reason?: unknown };
    if (typeof body.userId !== "string" || typeof body.disabled !== "boolean") return Response.json({ error: "请求参数无效。" }, { status: 422 });
    if (body.userId === actor.id) return Response.json({ error: "不能停用当前管理员账号。" }, { status: 422 });
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 240) : "";
    if (body.disabled && reason.length < 3) return Response.json({ error: "停用账号时请填写至少 3 个字符的原因。" }, { status: 422 });
    const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, disabledAt: true, adminIdentity: { select: { role: true } } } });
    if (!target) return Response.json({ error: "账号不存在。" }, { status: 404 });
    if (target.adminIdentity && (await prisma.adminIdentity.findUnique({ where: { userId: actor.id }, select: { role: true } }))?.role !== "super_admin") {
      return Response.json({ error: "只有超级管理员可以管理管理员账号。" }, { status: 403 });
    }
    if (Boolean(target.disabledAt) === body.disabled) return Response.json({ ok: true, unchanged: true });
    const disabledAt = body.disabled ? new Date() : null;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { disabledAt } });
      if (body.disabled) await tx.session.deleteMany({ where: { userId: target.id } });
      await tx.adminAuditLog.create({ data: {
        actorId: actor.id, action: body.disabled ? "user.disabled" : "user.enabled", targetType: "user", targetId: target.id,
        detailJson: JSON.stringify({ reason: reason || null, sessionsRevoked: body.disabled }),
      } });
    });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}
