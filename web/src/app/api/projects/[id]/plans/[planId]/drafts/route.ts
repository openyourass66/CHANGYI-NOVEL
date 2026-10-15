import { handleError, ok } from "@/lib/api";
import { listDrafts } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; planId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id, planId } = await params;
    return ok({ drafts: await listDrafts(id, planId) });
  } catch (error) {
    return handleError(error);
  }
}
