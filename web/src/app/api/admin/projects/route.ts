import { prisma } from "@/lib/db";
import { adminError, requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";
export function OPTIONS() { return new Response(null, { status: 204 }); }

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1));
    const where = q ? { OR: [{ name: { contains: q } }, { owner: { email: { contains: q } } }] } : {};
    const [total, rows] = await Promise.all([
      prisma.novelProject.count({ where }),
      prisma.novelProject.findMany({ where, skip: (page - 1) * 25, take: 25, orderBy: { updatedAt: "desc" }, select: {
        id: true, name: true, language: true, genre: true, createdAt: true, updatedAt: true,
        owner: { select: { email: true } }, _count: { select: { chapters: true, sourceDocuments: true, analysisRuns: true } },
        sourceDocuments: { select: { byteSize: true } },
      } }),
    ]);
    return Response.json({ projects: rows.map(({ _count, sourceDocuments, ...project }) => ({
      ...project, chapterCount: _count.chapters, documentCount: _count.sourceDocuments, runCount: _count.analysisRuns,
      storageBytes: sourceDocuments.reduce((sum, doc) => sum + doc.byteSize, 0),
    })), total, page, pageSize: 25 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return adminError(error); }
}
