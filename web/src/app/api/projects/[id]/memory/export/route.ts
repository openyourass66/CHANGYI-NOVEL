import { fail, handleError } from "@/lib/api";
import { exportFileName } from "@/lib/export";
import { exportMemoryMarkdown } from "@/lib/memory";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return fail("项目不存在。", 404);
    const text = await exportMemoryMarkdown(id);
    const fileName = exportFileName(`${project.name}-记忆`, "md");
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
