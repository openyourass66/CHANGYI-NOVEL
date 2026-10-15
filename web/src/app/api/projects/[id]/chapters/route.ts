import { withAccount } from "@/lib/access";
import { handleError, ok } from "@/lib/api";
import { listChapterSummaries } from "@/lib/chapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function handleGET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ chapters: await listChapterSummaries(id) });
  } catch (error) {
    return handleError(error);
  }
}

export const GET = withAccount("project", handleGET);
