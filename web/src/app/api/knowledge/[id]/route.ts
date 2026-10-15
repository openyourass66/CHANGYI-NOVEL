import { handleError, ok, readJson } from "@/lib/api";
import { deleteKnowledge, knowledgeInputSchema, updateKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = knowledgeInputSchema.parse(await readJson(request));
    return ok({ item: await updateKnowledge(id, input) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await deleteKnowledge(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
