import "server-only";
import { prisma } from "@/lib/db";
import { AnalysisError } from "@/lib/ai/errors";
import { deletePendingProposalsForDraft } from "@/lib/ai/proposals";
import {
  isIssueStatus,
  isIssueSeverity,
  parseEvidence,
  parseOutline,
  parseOutlineItem,
  parseStringArray,
  type ContinuityIssueView,
  type ContinuationPlanView,
  type DraftChapterView,
  type EvidenceRef,
  type MemoryUpdateStatus,
  type OutlineItem,
  type PlanStatus,
} from "@/lib/continuation-view";
import type { IssueSeverity, IssueStatus } from "@/lib/domain";
import { createDirectionSchema, directionName } from "@/lib/continuation-direction";

type PlanRow = {
  id: string;
  projectId: string;
  direction: string;
  summary: string | null;
  outlineJson: string;
  relatedThreadsJson: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

function toPlanView(row: PlanRow, draftCount: number): ContinuationPlanView {
  return {
    id: row.id,
    projectId: row.projectId,
    direction: row.direction,
    summary: row.summary,
    outline: parseOutline(row.outlineJson),
    relatedThreads: parseStringArray(row.relatedThreadsJson),
    status: row.status as PlanStatus,
    version: row.version,
    draftCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function draftCountsByPlan(projectId: string): Promise<Map<string, number>> {
  const rows = await prisma.draftChapter.groupBy({
    by: ["planId"],
    where: { projectId, planId: { not: null } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) if (r.planId) map.set(r.planId, r._count._all);
  return map;
}

export async function listPlans(projectId: string): Promise<ContinuationPlanView[]> {
  const [rows, counts] = await Promise.all([
    prisma.continuationPlan.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }],
    }),
    draftCountsByPlan(projectId),
  ]);
  // 已选定的方向排在最前，便于面板默认展开。
  const views = rows.map((r) => toPlanView(r, counts.get(r.id) ?? 0));
  return views.sort((a, b) => {
    if (a.status === b.status) return 0;
    if (a.status === "active") return -1;
    if (b.status === "active") return 1;
    return 0;
  });
}

export async function getPlan(id: string): Promise<ContinuationPlanView | null> {
  const row = await prisma.continuationPlan.findUnique({ where: { id } });
  if (!row) return null;
  const count = await prisma.draftChapter.count({ where: { planId: id } });
  return toPlanView(row, count);
}

/** 手动创建或从已有方向另存；章纲与草稿始终留在原方向。 */
export async function createPlan(projectId: string, input: unknown): Promise<ContinuationPlanView> {
  const value = createDirectionSchema.parse(input);
  const row = await prisma.$transaction(async (tx) => {
    if (!await tx.novelProject.findUnique({ where: { id: projectId }, select: { id: true } })) {
      throw new AnalysisError("项目不存在。", 404);
    }
    const source = value.sourcePlanId
      ? await tx.continuationPlan.findFirst({ where: { id: value.sourcePlanId, projectId } })
      : null;
    if (value.sourcePlanId && !source) throw new AnalysisError("原方向不存在。", 404);
    if (value.select) {
      await tx.continuationPlan.updateMany({ where: { projectId, status: "active" }, data: { status: "draft" } });
    }
    return tx.continuationPlan.create({ data: {
      projectId,
      direction: directionName(value.direction, value.summary),
      summary: value.summary,
      relatedThreadsJson: source?.relatedThreadsJson ?? "[]",
      status: value.select ? "active" : "draft",
    } });
  });
  return toPlanView(row, 0);
}

async function requirePlan(id: string): Promise<PlanRow> {
  const row = await prisma.continuationPlan.findUnique({ where: { id } });
  if (!row) throw new AnalysisError("续写方向不存在。", 404);
  return row;
}

export type PlanPatch = {
  direction?: string;
  summary?: string | null;
  outline?: OutlineItem[];
  relatedThreads?: string[];
  expectedVersion?: number;
  select?: boolean;
};

/** 编辑方向或章纲。任一实质改动都递增 version，便于草稿追溯所依据的章纲版本。 */
export async function updatePlan(id: string, patch: PlanPatch): Promise<ContinuationPlanView> {
  const current = await requirePlan(id);

  const data: Record<string, unknown> = {};
  if (patch.direction !== undefined) {
    const direction = patch.direction.trim();
    if (!direction) throw new AnalysisError("方向说明不能为空。");
    data.direction = direction;
  }
  if (patch.summary !== undefined) data.summary = patch.summary?.trim() || null;
  if (patch.outline !== undefined) {
    data.outlineJson = JSON.stringify(normalizeOutline(patch.outline));
  }
  if (patch.relatedThreads !== undefined) {
    data.relatedThreadsJson = JSON.stringify(patch.relatedThreads.map((s) => s.trim()).filter(Boolean));
  }
  const row = await prisma.$transaction(async (tx) => {
    const latest = await tx.continuationPlan.findUniqueOrThrow({ where: { id } });
    if (patch.expectedVersion !== undefined && latest.version !== patch.expectedVersion) {
      throw new AnalysisError("该方向已发生变化，请刷新后重新编辑。", 409);
    }
    const directionChanged = (data.direction !== undefined && data.direction !== latest.direction)
      || (data.summary !== undefined && data.summary !== latest.summary);
    if (directionChanged && (parseOutline(latest.outlineJson).length > 0
      || await tx.draftChapter.count({ where: { planId: id } }) > 0)) {
      throw new AnalysisError("该方向已有章纲或草稿，请另存为新方向。", 409);
    }
    if (patch.select) {
      await tx.continuationPlan.updateMany({
        where: { projectId: current.projectId, status: "active", id: { not: id } }, data: { status: "draft" },
      });
      data.status = "active";
    }
    if (Object.keys(data).length === 0) return latest;
    return tx.continuationPlan.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  });
  const count = await prisma.draftChapter.count({ where: { planId: id } });
  return toPlanView(row, count);
}

/** 章纲条目按数组顺序重排 index，保证 1..n 连续。 */
function normalizeOutline(items: OutlineItem[]): OutlineItem[] {
  return items.map((item, i) => ({
    index: i + 1,
    title: item.title.trim(),
    summary: item.summary?.trim() ?? "",
    beats: (item.beats ?? []).map((b) => b.trim()).filter(Boolean),
    relatedThreads: (item.relatedThreads ?? []).map((t) => t.trim()).filter(Boolean),
  }));
}

/** 选定某个方向：置为 active，同时把同项目其他 active 降回 draft（保持单一 active）。 */
export async function activatePlan(projectId: string, id: string): Promise<ContinuationPlanView> {
  const row = await requirePlan(id);
  if (row.projectId !== projectId) throw new AnalysisError("方向不属于该项目。", 404);

  await prisma.$transaction([
    prisma.continuationPlan.updateMany({
      where: { projectId, status: "active", id: { not: id } },
      data: { status: "draft" },
    }),
    prisma.continuationPlan.update({ where: { id }, data: { status: "active" } }),
  ]);

  return (await getPlan(id))!;
}

export async function deletePlan(id: string): Promise<void> {
  await prisma.continuationPlan.delete({ where: { id } });
}

/* ---------------------------------- 草稿 ---------------------------------- */

type DraftRow = {
  id: string;
  projectId: string;
  planId: string | null;
  index: number;
  title: string | null;
  content: string;
  outlineItemJson: string;
  version: number;
  memoryUpdateStatus: string;
  continuityCheckJson: string;
  createdAt: Date;
  updatedAt: Date;
};

/** 从 continuityCheckJson 取出上次检查时间；缺失或不可解析时为 null。 */
function checkedAtOf(json: string): string | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === "object" && "checkedAt" in parsed) {
      const value = (parsed as { checkedAt?: unknown }).checkedAt;
      if (typeof value === "string") return value;
    }
  } catch {
    // 忽略损坏的检查记录
  }
  return null;
}

function toDraftView(row: DraftRow): DraftChapterView {
  return {
    id: row.id,
    projectId: row.projectId,
    planId: row.planId,
    index: row.index,
    title: row.title,
    content: row.content,
    outlineItem: parseOutlineItem(row.outlineItemJson),
    version: row.version,
    memoryUpdateStatus: row.memoryUpdateStatus as MemoryUpdateStatus,
    continuityCheckedAt: checkedAtOf(row.continuityCheckJson),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listDrafts(projectId: string, planId?: string): Promise<DraftChapterView[]> {
  const rows = await prisma.draftChapter.findMany({
    where: { projectId, ...(planId ? { planId } : {}) },
    orderBy: [{ index: "asc" }],
  });
  return rows.map(toDraftView);
}

export async function getDraft(id: string): Promise<DraftChapterView | null> {
  const row = await prisma.draftChapter.findUnique({ where: { id } });
  return row ? toDraftView(row) : null;
}

async function requireDraft(id: string): Promise<DraftRow> {
  const row = await prisma.draftChapter.findUnique({ where: { id } });
  if (!row) throw new AnalysisError("草稿不存在。", 404);
  return row;
}

/** 手工编辑正文/标题。递增 version，并重置记忆增量状态（内容已变，旧提案不再对应）。 */
export async function updateDraft(
  id: string,
  patch: { title?: string | null; content?: string },
): Promise<DraftChapterView> {
  await requireDraft(id);
  const data: Record<string, unknown> = { version: { increment: 1 } };
  if (patch.title !== undefined) data.title = patch.title?.trim() || null;
  if (patch.content !== undefined) {
    if (!patch.content.trim()) throw new AnalysisError("草稿正文不能为空。");
    data.content = patch.content;
    data.memoryUpdateStatus = "none";
  }
  const row = await prisma.draftChapter.update({ where: { id }, data });
  // 正文变了，上一轮提取的记忆提案已不再对应本章，清掉尚未处置的部分。
  if (patch.content !== undefined) await deletePendingProposalsForDraft(id);
  return toDraftView(row);
}

export async function deleteDraft(id: string): Promise<void> {
  await prisma.draftChapter.delete({ where: { id } });
}

/* -------------------------------- 连续性检查 -------------------------------- */

type IssueRow = {
  id: string;
  projectId: string;
  draftId: string | null;
  category: string;
  severity: string;
  description: string;
  evidenceJson: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function toIssueView(row: IssueRow): ContinuityIssueView {
  return {
    id: row.id,
    projectId: row.projectId,
    draftId: row.draftId,
    category: row.category,
    severity: isIssueSeverity(row.severity) ? row.severity : "info",
    description: row.description,
    evidence: parseEvidence(row.evidenceJson),
    status: isIssueStatus(row.status) ? row.status : "open",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listIssues(
  projectId: string,
  opts: { draftId?: string } = {},
): Promise<ContinuityIssueView[]> {
  const rows = await prisma.continuityIssue.findMany({
    where: { projectId, ...(opts.draftId ? { draftId: opts.draftId } : {}) },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(toIssueView);
}

export async function getIssue(id: string): Promise<ContinuityIssueView | null> {
  const row = await prisma.continuityIssue.findUnique({ where: { id } });
  return row ? toIssueView(row) : null;
}

export async function updateIssue(
  id: string,
  patch: { status?: IssueStatus },
): Promise<ContinuityIssueView> {
  const row = await prisma.continuityIssue.findUnique({ where: { id }, select: { id: true } });
  if (!row) throw new AnalysisError("问题不存在。", 404);
  const data: Record<string, unknown> = {};
  if (patch.status !== undefined) {
    if (!isIssueStatus(patch.status)) throw new AnalysisError("未知的问题状态。");
    data.status = patch.status;
  }
  const updated = await prisma.continuityIssue.update({ where: { id }, data });
  return toIssueView(updated);
}

export type NewIssue = {
  category: string;
  severity: IssueSeverity;
  description: string;
  evidence: EvidenceRef[];
};

/**
 * 用一轮检查的结果替换某章草稿的全部问题。作者对旧问题的处置（采纳/忽略）无法映射到
 * 新问题的条目上，因此整批替换而不是逐条合并——避免留下已经不对应的旧条目。
 */
export async function replaceDraftIssues(draftId: string, issues: NewIssue[]): Promise<number> {
  const draft = await prisma.draftChapter.findUnique({
    where: { id: draftId },
    select: { projectId: true },
  });
  if (!draft) throw new AnalysisError("草稿不存在。", 404);

  await prisma.$transaction([
    prisma.continuityIssue.deleteMany({ where: { draftId } }),
    ...issues.map((issue) =>
      prisma.continuityIssue.create({
        data: {
          projectId: draft.projectId,
          draftId,
          category: issue.category,
          severity: issue.severity,
          description: issue.description,
          evidenceJson: JSON.stringify(issue.evidence),
        },
      }),
    ),
  ]);
  return issues.length;
}
