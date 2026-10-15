import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { listIssues } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const draftId = new URL(request.url).searchParams.get("draftId") ?? undefined;
    return ok({ issues: await listIssues(id, { draftId }) });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
