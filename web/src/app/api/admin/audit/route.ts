import { prisma } from "@/lib/db";
import { adminError, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204 }); }

export async function GET(request: Request) {
  try {
    const { role } = await requireAdmin(request);
    if (role !== "super_admin") return Response.json({ error: "只有超级管理员可以查看操作审计。" }, { status: 403 });
    const page = Math.max(1, Math.min(10000, Number(new URL(request.url).searchParams.get("page")) || 1));
    const [total, logs] = await Promise.all([
      prisma.adminAuditLog.count(),
      prisma.adminAuditLog.findMany({ skip: (page - 1) * 25, take: 25, orderBy: { createdAt: "desc" }, select: {
        id: true, action: true, targetType: true, targetId: true, detailJson: true, createdAt: true,
        actor: { select: { email: true } },
      } }),
    ]);
    return Response.json({ logs, total, page, pageSize: 25 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}
