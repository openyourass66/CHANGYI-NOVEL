import { z } from "zod";
import { fail, handleError, ok, readJson } from "@/lib/api";
import { listMemoryHistory, updateMemoryEntry } from "@/lib/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const restoreSchema = z.object({ revision: z.number().int().min(1) });

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    return ok({ history: await listMemoryHistory(id) });
  } catch (error) {
    return handleError(error);
  }
}

/** 恢复历史版本：以该版本内容生成一个新的当前版本，保留完整修订记录。 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { revision } = restoreSchema.parse(await readJson(request));
    const history = await listMemoryHistory(id);
    const target = history.find((h) => h.revision === revision);
    if (!target) return fail("未找到该历史版本。", 404);
    const entry = await updateMemoryEntry(id, {
      category: target.category,
      key: target.key ?? undefined,
      title: target.title ?? undefined,
      content: target.content,
      status: target.status,
      citations: target.citations,
    });
    return ok({ entry });
  } catch (error) {
    return handleError(error);
  }
}
