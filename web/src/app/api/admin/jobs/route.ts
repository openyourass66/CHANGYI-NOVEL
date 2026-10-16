import { prisma } from "@/lib/db";
import { adminError, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204 }); }

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1));
    const where = ["pending", "running", "done", "failed", "canceled"].includes(status ?? "") ? { status: status! } : {};
    const [total, rows] = await Promise.all([
      prisma.analysisRun.count({ where }),
      prisma.analysisRun.findMany({ where, skip: (page - 1) * 25, take: 25, orderBy: { createdAt: "desc" }, select: {
        id: true, taskType: true, status: true, createdAt: true, startedAt: true, finishedAt: true, modelProfileId: true,
        project: { select: { name: true, owner: { select: { email: true } } } },
      } }),
    ]);
    return Response.json({ jobs: rows, total, page, pageSize: 25 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}
