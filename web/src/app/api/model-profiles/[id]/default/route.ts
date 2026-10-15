import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { setDefaultProfile } from "@/lib/ai/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handlePOST(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await setDefaultProfile(id);
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}

export const POST = withAccount("profile", handlePOST);
