import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { deleteProject, getProjectOverview } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const project = await getProjectOverview(id);
    if (!project) return ok({ error: "项目不存在" }, { status: 404 });
    return ok({ project });
  } catch (error) {
    return handleError(error);
  }
}

async function handleDELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteProject(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
export const DELETE = withAccount("project", handleDELETE);
