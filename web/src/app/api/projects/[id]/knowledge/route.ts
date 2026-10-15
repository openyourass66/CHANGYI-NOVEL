import { handleError, ok, readJson } from "@/lib/api";
import { createKnowledge, knowledgeInputSchema, listKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ knowledge: await listKnowledge(id) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = knowledgeInputSchema.parse(await readJson(request));
    return ok({ item: await createKnowledge(id, input) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
