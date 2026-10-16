import { prisma } from "@/lib/db";
import { adminError, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204 }); }

export async function GET(request: Request) {
  try {
    const { user, role } = await requireAdmin(request);
    const [users, projects, runs, failedRuns, activeRuns, recentRuns, recentAudit] = await Promise.all([
      prisma.user.count(), prisma.novelProject.count(), prisma.analysisRun.count(),
      prisma.analysisRun.count({ where: { status: "failed" } }),
      prisma.analysisRun.count({ where: { status: { in: ["pending", "running"] } } }),
      prisma.analysisRun.findMany({ take: 8, orderBy: { createdAt: "desc" }, select: {
        id: true, taskType: true, status: true, createdAt: true, startedAt: true, finishedAt: true,
        project: { select: { name: true, owner: { select: { email: true } } } },
      } }),
      role === "super_admin" ? prisma.adminAuditLog.findMany({ take: 5, orderBy: { createdAt: "desc" }, select: {
        id: true, action: true, targetType: true, targetId: true, createdAt: true,
        actor: { select: { email: true } },
      } }) : Promise.resolve([]),
    ]);
    return Response.json({ role, user: { email: user.email }, counts: { users, projects, runs, failedRuns, activeRuns }, recentRuns, recentAudit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}
