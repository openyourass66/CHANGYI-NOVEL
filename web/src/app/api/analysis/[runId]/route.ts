import { withAccount } from "@/lib/access";
import { fail, handleError, ok } from "@/lib/api";
import { getRunProgress } from "@/lib/ai/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { runId } = await params;
    const run = await getRunProgress(runId);
    if (!run) return fail("任务不存在。", 404);
    return ok({ run });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("run", handleGET);
