import { handleError, ok, readJson } from "@/lib/api";
import { deleteDraft, getDraft, updateDraft } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; draftId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { draftId } = await params;
    const draft = await getDraft(draftId);
    if (!draft) return ok({ error: "草稿不存在。" }, { status: 404 });
    return ok({ draft });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { draftId } = await params;
    const body = (await readJson(request)) as { title?: string | null; content?: string };
    const patch: { title?: string | null; content?: string } = {};
    if (body.title === null || typeof body.title === "string") patch.title = body.title;
    if (typeof body.content === "string") patch.content = body.content;
    return ok({ draft: await updateDraft(draftId, patch) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { draftId } = await params;
    await deleteDraft(draftId);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
