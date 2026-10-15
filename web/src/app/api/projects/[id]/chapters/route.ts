import { handleError, ok } from "@/lib/api";
import { listChapterSummaries } from "@/lib/chapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ chapters: await listChapterSummaries(id) });
  } catch (error) {
    return handleError(error);
  }
}
