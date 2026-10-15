import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { previewRun } from "@/lib/ai/preview";
import type { RunPayload } from "@/lib/ai/tasks/types";

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
      payload?: RunPayload;
    };
    const preview = await previewRun(id, {
      chapterIds: Array.isArray(body.chapterIds) ? body.chapterIds : undefined,
      taskType: body.taskType ?? "chapter-extract",
      profileId: body.profileId ?? "",
      payload: body.payload,
    });
    return ok({ preview });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("project", handlePOST);
