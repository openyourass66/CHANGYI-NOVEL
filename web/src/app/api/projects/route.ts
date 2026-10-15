import { handleError, ok, readJson } from "@/lib/api";
import { createProject, listProjects, projectInputSchema } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return ok({ projects: await listProjects() });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = projectInputSchema.parse(await readJson(request));
    const project = await createProject(input);
    return ok({ project: { id: project.id, name: project.name } }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
