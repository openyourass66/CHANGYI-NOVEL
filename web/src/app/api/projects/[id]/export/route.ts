import { fail, handleError } from "@/lib/api";
import { buildProjectExport, buildSourceText, exportFileName } from "@/lib/export";
import { getProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function attachment(body: string, fileName: string, contentType: string) {
  const encoded = encodeURIComponent(fileName);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const project = await getProject(id);
    if (!project) return fail("项目不存在。", 404);

    const format = new URL(request.url).searchParams.get("format") ?? "json";
    if (format === "txt") {
      const text = await buildSourceText(id);
      return attachment(
        text,
        exportFileName(project.name, "txt"),
        "text/plain; charset=utf-8",
      );
    }
    if (format === "json") {
      const data = await buildProjectExport(id);
      return attachment(
        JSON.stringify(data, null, 2),
        exportFileName(project.name, "json"),
        "application/json; charset=utf-8",
      );
    }
    return fail("不支持的导出格式。", 400);
  } catch (error) {
    return handleError(error);
  }
}
