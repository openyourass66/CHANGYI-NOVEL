import { handleError, ok } from "@/lib/api";
import { rejectProposal } from "@/lib/ai/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ proposal: await rejectProposal(id) });
  } catch (error) {
    return handleError(error);
  }
}
