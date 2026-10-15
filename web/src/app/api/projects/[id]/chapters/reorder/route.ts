import { z } from "zod";
import { handleError, ok, readJson } from "@/lib/api";
import { listChapterSummaries, reorderChapters } from "@/lib/chapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ orderedIds: z.array(z.string().min(1)).min(1) });

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { orderedIds } = schema.parse(await readJson(request));
    await reorderChapters(id, orderedIds);
    return ok({ chapters: await listChapterSummaries(id) });
  } catch (error) {
    return handleError(error);
  }
}
