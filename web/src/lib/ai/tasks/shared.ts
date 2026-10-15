import "server-only";
import { prisma } from "@/lib/db";
import { AnalysisError } from "@/lib/ai/errors";

/** 整项目统合与续写族任务共用的提示词片段：这类任务没有可逐字回链的原文片段。 */
export const NO_SOURCE_RULE =
  "本任务基于已抽取的记忆与章节标题进行，不需要逐字原文片段（excerpt）。";

export const NO_SOURCE_NOTE =
  "本任务不产出原文出处片段，结果一律标记为「推断」，需经作者确认后才作数。";

/**
 * 续写族任务的前提：必须先有可依据的记忆。没有记忆时生成的「续写」只是凭空发挥，
 * 因此一律前置拦截，而不是产出一堆无从依据的草稿。
 */
export async function assertHasMemory(projectId: string): Promise<void> {
  const count = await prisma.memoryEntry.count({ where: { projectId, isCurrent: true } });
  if (count === 0) {
    throw new AnalysisError("还没有记忆条目可供参考，请先运行「逐章抽取」。");
  }
}

/** 解析续写族任务的依据方向：优先用调用方指定的 planId，否则回落到当前已选定的方向。 */
export async function resolvePlanId(
  projectId: string,
  payloadPlanId?: string,
): Promise<string> {
  if (payloadPlanId) {
    const plan = await prisma.continuationPlan.findUnique({
      where: { id: payloadPlanId },
      select: { projectId: true },
    });
    if (!plan || plan.projectId !== projectId) {
      throw new AnalysisError("续写方向不存在。", 404);
    }
    return payloadPlanId;
  }
  const active = await prisma.continuationPlan.findFirst({
    where: { projectId, status: "active" },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  if (!active) {
    throw new AnalysisError("请先选定一个续写方向。");
  }
  return active.id;
}

/** 待处理的续写草稿行（连续性检查 / 草稿记忆增量共用）。 */
export type DraftRow = {
  id: string;
  projectId: string;
  planId: string | null;
  index: number;
  title: string | null;
  content: string;
  outlineItemJson: string;
};

const DRAFT_SELECT = {
  id: true,
  projectId: true,
  planId: true,
  index: true,
  title: true,
  content: true,
  outlineItemJson: true,
} as const;

export async function loadDraftRow(projectId: string, draftId: string): Promise<DraftRow> {
  const row = await prisma.draftChapter.findFirst({
    where: { id: draftId, projectId },
    select: DRAFT_SELECT,
  });
  if (!row) throw new AnalysisError("草稿不存在。", 404);
  return row;
}

/** 待检查/待提取的草稿：指定 draftId 时只取该章，否则取所选方向的全部草稿。 */
export async function resolveDraftTargets(
  projectId: string,
  payload: { planId?: string; draftId?: string },
): Promise<DraftRow[]> {
  if (payload.draftId) return [await loadDraftRow(projectId, payload.draftId)];

  const planId = await resolvePlanId(projectId, payload.planId);
  const rows = await prisma.draftChapter.findMany({
    where: { projectId, planId },
    orderBy: { index: "asc" },
    select: DRAFT_SELECT,
  });
  if (rows.length === 0) {
    throw new AnalysisError("这个方向还没有草稿，请先运行「生成草稿」。");
  }
  return rows;
}
