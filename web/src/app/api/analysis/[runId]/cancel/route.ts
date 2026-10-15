import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { cancelRun } from "@/lib/ai/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

async function handlePOST(_request: Request, { params }: Ctx) {
  try {
    const { runId } = await params;
    return ok({ run: await cancelRun(runId) });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("run", handlePOST);
