import { handleError, ok } from "@/lib/api";
import { listPlans } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ plans: await listPlans(id) });
  } catch (error) {
    return handleError(error);
  }
}
