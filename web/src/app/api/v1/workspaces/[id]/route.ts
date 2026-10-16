import { z } from "zod";
import { withAccount } from "@/lib/access";
import { getWorkspaceView } from "@/lib/workspaces";
import { ok, fail } from "@/lib/api";
export const runtime = "nodejs";
export const GET = withAccount("project", async (request, context) => {
  const view = z.enum(["chapters", "analysis", "memory", "continuation"]).parse(new URL(request.url).searchParams.get("view") ?? "chapters");
  const data = await getWorkspaceView((await context.params).id, view);
  return data ? ok({ workspace: data }) : fail("项目不存在。", 404);
});
