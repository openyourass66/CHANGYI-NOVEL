import { handleError, ok } from "@/lib/api";
import { activatePlan } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; planId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id, planId } = await params;
    return ok({ plan: await activatePlan(id, planId) });
  } catch (error) {
    return handleError(error);
  }
}
