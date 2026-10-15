import { withAccount } from "@/lib/access";
import { handleError, ok, readJson } from "@/lib/api";
import { createKnowledge, knowledgeInputSchema, listKnowledge } from "@/lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ knowledge: await listKnowledge(id) });
  } catch (error) {
    return handleError(error);
  }
}

async function handlePOST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const input = knowledgeInputSchema.parse(await readJson(request));
    return ok({ item: await createKnowledge(id, input) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
export const POST = withAccount("project", handlePOST);
