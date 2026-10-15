import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { listDrafts } from "@/lib/continuation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; planId: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { id, planId } = await params;
    return ok({ drafts: await listDrafts(id, planId) });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
