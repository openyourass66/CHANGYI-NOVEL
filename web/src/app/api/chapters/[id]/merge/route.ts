import { z } from "zod";
import { handleError, ok, readJson } from "@/lib/api";
import { mergeChapters } from "@/lib/chapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ nextId: z.string().min(1) });

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { nextId } = schema.parse(await readJson(request));
    return ok({ chapters: await mergeChapters(id, nextId) });
  } catch (error) {
    return handleError(error);
  }
}
