import { handleError, ok } from "@/lib/api";
import { acceptProposal } from "@/lib/ai/proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok(await acceptProposal(id));
  } catch (error) {
    return handleError(error);
  }
}
