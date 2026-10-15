import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { activatePlan } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; planId: string }> };

async function handlePOST(_request: Request, { params }: Ctx) {
  try {
    const { id, planId } = await params;
    return ok({ plan: await activatePlan(id, planId) });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("project", handlePOST);
