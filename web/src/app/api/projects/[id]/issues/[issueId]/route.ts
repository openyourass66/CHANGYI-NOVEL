import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { getIssue, updateIssue } from "@/lib/continuation";
import { isIssueStatus } from "@/lib/continuation-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; issueId: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { issueId } = await params;
    const issue = await getIssue(issueId);
    if (!issue) return ok({ error: "问题不存在。" }, { status: 404 });
    return ok({ issue });
  } catch (error) {
    return handleError(error);
  }
}

async function handlePATCH(request: Request, { params }: Ctx) {
  try {
    const { issueId } = await params;
    const body = (await readJson(request)) as { status?: string };
    const patch: { status?: Parameters<typeof updateIssue>[1]["status"] } = {};
    if (body.status !== undefined) {
      if (!isIssueStatus(body.status)) return ok({ error: "未知的问题状态。" }, { status: 400 });
      patch.status = body.status;
    }
    return ok({ issue: await updateIssue(issueId, patch) });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
export const PATCH = withAccount("project", handlePATCH);
