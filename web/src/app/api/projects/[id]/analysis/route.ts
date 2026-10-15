import { handleError, ok, readJson } from "@/lib/api";
import { startAnalysisRun } from "@/lib/ai/runner";
import type { RunPayload } from "@/lib/ai/tasks/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await readJson(request)) as {
      chapterIds?: string[];
      taskType?: string;
      profileId?: string;
      authorized?: boolean;
      payload?: RunPayload;
    };
    const runId = await startAnalysisRun(id, {
      chapterIds: Array.isArray(body.chapterIds) ? body.chapterIds : undefined,
      taskType: body.taskType ?? "chapter-extract",
      profileId: body.profileId ?? "",
      authorized: body.authorized === true,
      payload: body.payload,
    });
    return ok({ runId }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
