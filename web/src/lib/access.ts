import "server-only";
import { prisma } from "@/lib/db";
import { handleError } from "@/lib/api";
import { AccessError, userFromHeaders } from "@/lib/auth-session";

type Scope = "account" | "project" | "chapter" | "memory" | "knowledge" | "proposal" | "run" | "profile";
type Context<P> = { params: Promise<P> };

export async function assertOwnedResource(scope: Scope, id: string, userId: string) {
  const project = { ownerId: userId };
  let row;
  switch (scope) {
    case "project": row = await prisma.novelProject.findFirst({ where: { id, ownerId: userId }, select: { id: true } }); break;
    case "profile": row = await prisma.modelProfile.findFirst({ where: { id, userId }, select: { id: true } }); break;
    case "chapter": row = await prisma.chapter.findFirst({ where: { id, project }, select: { id: true } }); break;
    case "memory": row = await prisma.memoryEntry.findFirst({ where: { id, project }, select: { id: true } }); break;
    case "knowledge": row = await prisma.characterKnowledge.findFirst({ where: { id, project }, select: { id: true } }); break;
    case "proposal": row = await prisma.memoryProposal.findFirst({ where: { id, project }, select: { id: true } }); break;
    case "run": row = await prisma.analysisRun.findFirst({ where: { id, project }, select: { id: true } }); break;
    case "account": return;
  }
  if (!row) throw new AccessError("资源不存在。", 404);
}

/** 每个业务 API 显式声明资源范围；在读正文、密钥或文件前校验会话与归属。 */
export function withAccount<P extends Record<string, string>>(
  scope: Scope,
  handler: (request: Request, context: Context<P>) => Promise<Response>,
) {
  return async (request: Request, context: Context<P>) => {
    try {
      const user = await userFromHeaders(request.headers);
      if (!user) throw new AccessError("请先登录并验证邮箱。", 401);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        const origin = request.headers.get("origin");
        const expected = new URL(process.env.BETTER_AUTH_URL ?? request.url).origin;
        if (origin !== expected) throw new AccessError("请求来源无效，请刷新后重试。", 403);
      }
      if (scope !== "account") {
        const params = await context.params;
        await assertOwnedResource(scope, params.runId ?? params.id, user.id);
        if (scope === "project") {
          const nested = params.planId
            ? await prisma.continuationPlan.findFirst({ where: { id: params.planId, projectId: params.id }, select: { id: true } })
            : params.draftId
              ? await prisma.draftChapter.findFirst({ where: { id: params.draftId, projectId: params.id }, select: { id: true } })
              : params.issueId
                ? await prisma.continuityIssue.findFirst({ where: { id: params.issueId, projectId: params.id }, select: { id: true } })
                : true;
          if (!nested) throw new AccessError("资源不存在。", 404);
        }
      }
      return await handler(request, context);
    } catch (error) {
      return handleError(error);
    }
  };
}
