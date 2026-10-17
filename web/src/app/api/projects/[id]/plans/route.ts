import { handleError, ok, readJson } from "@/lib/api";
import { createPlan, listPlans } from "@/lib/continuation";

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

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ plan: await createPlan(id, await readJson(request)) }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
