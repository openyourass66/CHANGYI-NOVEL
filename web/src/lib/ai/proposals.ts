import "server-only";
import { prisma } from "@/lib/db";
import { parseCitations, type CitationView } from "@/lib/memory-view";
import {
  createModelMemoryEntry,
  findCurrentEntryByKey,
  HumanEditedError,
  updateModelMemoryEntry,
  type MemoryInput,
} from "@/lib/memory";
import type { MemoryCategory, MemoryStatus } from "@/lib/domain";
import type { MemoryUpdateStatus } from "@/lib/continuation-view";
import type {
  ProposalDraft,
  ProposalKind,
  ProposalState,
  ProposalView,
} from "@/lib/ai/types";

/** 提案来源：逐章任务带章节 id，草稿增量带草稿 id，全书统合两者皆空。 */
export type RunDraft = {
  chapterId: string | null;
  draftId?: string | null;
  draft: ProposalDraft;
};

type ChapterLabel = { title: string; index: number };

async function chapterLabels(projectId: string): Promise<Map<string, ChapterLabel>> {
  const rows = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, rawTitle: true },
  });
  const map = new Map<string, ChapterLabel>();
  rows.forEach((c, i) => map.set(c.id, { title: c.rawTitle, index: i + 1 }));
  return map;
}

/** 草稿 id → 可读标签（如「第 2 章 · 血旗」），用于在审阅界面标注提案来源。 */
async function draftLabels(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.draftChapter.findMany({
    where: { projectId },
    select: { id: true, index: true, title: true },
  });
  return new Map(rows.map((d) => [d.id, `第 ${d.index} 章 · ${d.title ?? "（无标题）"}`]));
}

type ProposalRow = {
  id: string;
  runId: string | null;
  chapterId: string | null;
  draftId: string | null;
  kind: string;
  category: string;
  key: string | null;
  title: string | null;
  content: string;
  status: string;
  citationsJson: string;
  targetEntryId: string | null;
  reason: string | null;
  state: string;
  createdAt: Date;
};

function toView(
  row: ProposalRow,
  labels: Map<string, ChapterLabel>,
  drafts: Map<string, string>,
): ProposalView {
  const citations: CitationView[] = parseCitations(row.citationsJson).map((c) => {
    const label = labels.get(c.chapterId);
    return {
      ...c,
      chapterTitle: label?.title ?? "（章节已删除）",
      chapterIndex: label?.index ?? 0,
    };
  });
  return {
    id: row.id,
    runId: row.runId,
    chapterId: row.chapterId,
    draftId: row.draftId,
    draftLabel: row.draftId ? (drafts.get(row.draftId) ?? "（草稿已删除）") : null,
    kind: row.kind as ProposalKind,
    category: row.category as MemoryCategory,
    key: row.key,
    title: row.title,
    content: row.content,
    status: row.status as MemoryStatus,
    citations,
    targetEntryId: row.targetEntryId,
    reason: row.reason,
    state: row.state as ProposalState,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 依据当前记忆判定每条提案的动作：无键或键无对应条目 → add；
 * 命中已被人工修改的条目 → conflict（需人工裁决）；否则 → update。
 */
export async function createProposalsFromRun(
  runId: string,
  projectId: string,
  items: RunDraft[],
): Promise<number> {
  let created = 0;
  for (const { chapterId, draftId, draft } of items) {
    const key = draft.key?.trim() || null;
    let kind: ProposalKind = "add";
    let targetEntryId: string | null = null;
    if (key) {
      const existing = await findCurrentEntryByKey(projectId, draft.category, key);
      if (existing) {
        targetEntryId = existing.id;
        kind = existing.isUserEdited ? "conflict" : "update";
      }
    }
    await prisma.memoryProposal.create({
      data: {
        projectId,
        runId,
        chapterId,
        draftId: draftId ?? null,
        kind,
        category: draft.category,
        key,
        title: draft.title?.trim() || null,
        content: draft.content,
        status: draft.status,
        citationsJson: JSON.stringify(draft.citations),
        targetEntryId,
        reason: kind === "conflict" ? "目标条目已人工修改，需人工裁决。" : null,
        state: "pending",
      },
    });
    created += 1;
  }
  return created;
}

export async function listProposals(
  projectId: string,
  state?: ProposalState,
): Promise<ProposalView[]> {
  const [labels, drafts] = await Promise.all([chapterLabels(projectId), draftLabels(projectId)]);
  const rows = await prisma.memoryProposal.findMany({
    where: { projectId, ...(state ? { state } : {}) },
    orderBy: [{ createdAt: "desc" }],
  });
  return rows.map((r) => toView(r, labels, drafts));
}

export async function proposalCounts(projectId: string): Promise<Record<string, number>> {
  const rows = await prisma.memoryProposal.groupBy({
    by: ["state"],
    where: { projectId },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.state] = r._count._all;
  return counts;
}

/**
 * 依据该草稿现存提案的处置情况重算记忆增量状态：
 * 还有待处置或待裁决的 → proposed；都已处置且至少采纳过一条 → applied；全部忽略 → none。
 */
export async function reconcileDraftMemoryStatus(draftId: string): Promise<void> {
  const draft = await prisma.draftChapter.findUnique({
    where: { id: draftId },
    select: { memoryUpdateStatus: true },
  });
  if (!draft) return;

  const [pending, conflicted, accepted] = await Promise.all([
    prisma.memoryProposal.count({ where: { draftId, state: "pending" } }),
    prisma.memoryProposal.count({ where: { draftId, state: "conflicted" } }),
    prisma.memoryProposal.count({ where: { draftId, state: "accepted" } }),
  ]);
  const next: MemoryUpdateStatus =
    pending > 0 || conflicted > 0 ? "proposed" : accepted > 0 ? "applied" : "none";
  if (next !== draft.memoryUpdateStatus) {
    await prisma.draftChapter.update({
      where: { id: draftId },
      data: { memoryUpdateStatus: next },
    });
  }
}

export type AcceptResult = { proposal: ProposalView; message?: string };

/** 采纳提案：add/conflict → 新建条目；update → 追加新版本。人工已修改被拦截则转为 conflicted。 */
export async function acceptProposal(id: string): Promise<AcceptResult> {
  const row = await prisma.memoryProposal.findUnique({ where: { id } });
  if (!row) throw new Error("提案不存在。");
  const [labels, drafts] = await Promise.all([
    chapterLabels(row.projectId),
    draftLabels(row.projectId),
  ]);
  if (row.state !== "pending") return { proposal: toView(row, labels, drafts) };

  const input: MemoryInput = {
    category: row.category as MemoryCategory,
    key: row.key ?? undefined,
    title: row.title ?? undefined,
    content: row.content,
    status: row.status as MemoryStatus,
    citations: parseCitations(row.citationsJson),
  };

  try {
    // 命中既有条目（update / conflict）一律走受保护更新：若目标已被人工修改则被拦截，
    // 绝不静默覆盖，也绝不改道新建出重复条目。
    if (row.targetEntryId) {
      await updateModelMemoryEntry(row.targetEntryId, input);
    } else {
      await createModelMemoryEntry(row.projectId, input);
    }
    const updated = await prisma.memoryProposal.update({
      where: { id },
      data: { state: "accepted" },
    });
    if (updated.draftId) await reconcileDraftMemoryStatus(updated.draftId);
    return { proposal: toView(updated, labels, drafts) };
  } catch (error) {
    if (error instanceof HumanEditedError) {
      const updated = await prisma.memoryProposal.update({
        where: { id },
        data: { state: "conflicted", reason: error.message },
      });
      // 冲突仍需人工裁决，草稿状态保持 proposed。
      return { proposal: toView(updated, labels, drafts), message: error.message };
    }
    throw error;
  }
}

export async function rejectProposal(id: string): Promise<ProposalView> {
  const row = await prisma.memoryProposal.update({
    where: { id },
    data: { state: "rejected" },
  });
  if (row.draftId) await reconcileDraftMemoryStatus(row.draftId);
  const [labels, drafts] = await Promise.all([
    chapterLabels(row.projectId),
    draftLabels(row.projectId),
  ]);
  return toView(row, labels, drafts);
}

export async function acceptAllPending(
  projectId: string,
): Promise<{ accepted: number; conflicted: number }> {
  const pending = await prisma.memoryProposal.findMany({
    where: { projectId, state: "pending" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  let accepted = 0;
  let conflicted = 0;
  for (const p of pending) {
    const res = await acceptProposal(p.id);
    if (res.proposal.state === "conflicted") conflicted += 1;
    else if (res.proposal.state === "accepted") accepted += 1;
  }
  return { accepted, conflicted };
}

export async function deleteProposalsForRun(runId: string): Promise<void> {
  await prisma.memoryProposal.deleteMany({ where: { runId, state: "pending" } });
}

/** 重新提取某章草稿的记忆增量前，清掉上一轮尚未处置的提案，避免重复堆积。 */
export async function deletePendingProposalsForDraft(draftId: string): Promise<void> {
  await prisma.memoryProposal.deleteMany({ where: { draftId, state: "pending" } });
}
