import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { createProject, listProjects, projectInputSchema } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleGET() {
  try {
    return ok({ projects: await listProjects() });
  } catch (error) {
    return handleError(error);
  }
}

async function handlePOST(request: Request) {
  try {
    const input = projectInputSchema.parse(await readJson(request));
    const project = await createProject(input);
    return ok({ project: { id: project.id, name: project.name } }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("account", handleGET);
export const POST = withAccount("account", handlePOST);
