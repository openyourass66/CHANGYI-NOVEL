import { handleError, ok } from "@/lib/api";
import { setDefaultProfile } from "@/lib/ai/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await setDefaultProfile(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
