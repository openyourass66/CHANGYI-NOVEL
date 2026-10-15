import { handleError, ok, readJson } from "@/lib/api";
import { deletePlan, getPlan, updatePlan, type PlanPatch } from "@/lib/continuation";
import { parseOutline, parseStringArray, type OutlineItem } from "@/lib/continuation-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; planId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { planId } = await params;
    const plan = await getPlan(planId);
    if (!plan) return ok({ error: "续写方向不存在。" }, { status: 404 });
    return ok({ plan });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { planId } = await params;
    const body = (await readJson(request)) as {
      direction?: string;
      summary?: string | null;
      outline?: unknown;
      relatedThreads?: unknown;
    };

    const patch: PlanPatch = {};
    if (typeof body.direction === "string") patch.direction = body.direction;
    if (body.summary === null || typeof body.summary === "string") patch.summary = body.summary;
    if (body.outline !== undefined) {
      // 客户端回传的是条目数组；一并容忍序列化字符串。
      const raw = typeof body.outline === "string" ? parseOutline(body.outline) : body.outline;
      patch.outline = normalizeOutlineInput(raw);
    }
    if (body.relatedThreads !== undefined) {
      patch.relatedThreads =
        typeof body.relatedThreads === "string"
          ? parseStringArray(body.relatedThreads)
          : toStringList(body.relatedThreads);
    }

    return ok({ plan: await updatePlan(planId, patch) });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { planId } = await params;
    await deletePlan(planId);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

/** 宽松收下客户端提交的章纲条目；真正落库前由 updatePlan 统一重排 index 并裁剪空值。 */
function normalizeOutlineInput(value: unknown): OutlineItem[] {
  if (!Array.isArray(value)) return [];
  const items: OutlineItem[] = [];
  value.forEach((raw, i) => {
    if (typeof raw !== "object" || raw === null) return;
    const r = raw as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    if (!title) return;
    items.push({
      index: typeof r.index === "number" ? r.index : i + 1,
      title,
      summary: typeof r.summary === "string" ? r.summary : "",
      beats: toStringList(r.beats),
      relatedThreads: toStringList(r.relatedThreads),
    });
  });
  return items;
}
