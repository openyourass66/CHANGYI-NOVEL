import { handleError, ok } from "@/lib/api";
import { resumeRun } from "@/lib/ai/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ runId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { runId } = await params;
    return ok({ run: await resumeRun(runId) });
  } catch (error) {
    return handleError(error);
  }
}
