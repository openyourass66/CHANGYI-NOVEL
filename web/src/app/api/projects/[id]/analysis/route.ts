import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { startAnalysisRun } from "@/lib/ai/runner";
import type { RunPayload } from "@/lib/ai/tasks/types";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await readJson(request)) as {
      chapterIds?: string[];
      taskType?: string;
      profileId?: string;
      authorized?: boolean;
      payload?: RunPayload;
      deviceId?: string;
    };
    const runId = await startAnalysisRun(id, {
      chapterIds: Array.isArray(body.chapterIds) ? body.chapterIds : undefined,
      taskType: body.taskType ?? "chapter-extract",
      profileId: body.profileId ?? "",
      authorized: body.authorized === true,
      payload: body.payload,
      deviceId: z.string().uuid().optional().parse(body.deviceId),
    });
    return ok({ runId }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("project", handlePOST);
