import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  parseCitations,
  type CitationRef,
  type CitationView,
  type KeyConflict,
  type MemoryEntryView,
} from "@/lib/memory-view";
import {
  MEMORY_CATEGORY,
  MEMORY_CATEGORY_STATUS,
  type MemoryCategory,
  type MemoryStatus,
} from "@/lib/domain";

export type { CitationRef, CitationView, KeyConflict, MemoryEntryView };
export { parseCitations };

const categoryValues = Object.keys(MEMORY_CATEGORY) as [MemoryCategory, ...MemoryCategory[]];
const statusValues = [
  "confirmed",
  "inferred",
  "unknown",
  "open",
  "advanced",
  "resolved",
  "uncertain",
] as const;

export const citationSchema = z.object({
  chapterId: z.string().min(1),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  excerpt: z.string().trim().max(500),
});

export const memoryInputSchema = z.object({
  category: z.enum(categoryValues),
  key: z.string().trim().max(120).optional(),
  title: z.string().trim().max(200).optional(),
  content: z.string().trim().min(1, "内容不能为空").max(20000),
  status: z.enum(statusValues),
  citations: z.array(citationSchema).max(50).optional(),
});
export type MemoryInput = z.infer<typeof memoryInputSchema>;

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

function toView(
  row: {
    id: string;
    category: string;
    key: string | null;
    title: string | null;
    content: string;
    status: string;
    sourceCitationsJson: string;
    isUserEdited: boolean;
    revision: number;
    supersedesId: string | null;
    updatedAt: Date;
  },
  labels: Map<string, ChapterLabel>,
): MemoryEntryView {
  const citations: CitationView[] = parseCitations(row.sourceCitationsJson).map((c) => {
    const label = labels.get(c.chapterId);
    return {
      ...c,
      chapterTitle: label?.title ?? "（章节已删除）",
      chapterIndex: label?.index ?? 0,
    };
  });
  return {
    id: row.id,
    category: row.category as MemoryCategory,
    key: row.key,
    title: row.title,
    content: row.content,
    status: row.status as MemoryStatus,
    citations,
    isUserEdited: row.isUserEdited,
    revision: row.revision,
    supersedesId: row.supersedesId,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertStatusAllowed(category: MemoryCategory, status: MemoryStatus): void {
  if (!MEMORY_CATEGORY_STATUS[category].includes(status)) {
    throw new Error(`「${MEMORY_CATEGORY[category]}」不支持状态「${status}」。`);
  }
}

export type MemoryQuery = { category?: MemoryCategory; query?: string };

export async function listMemoryEntries(
  projectId: string,
  opts: MemoryQuery = {},
): Promise<MemoryEntryView[]> {
  const labels = await chapterLabels(projectId);
  const rows = await prisma.memoryEntry.findMany({
    where: {
      projectId,
      isCurrent: true,
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.query
        ? {
            OR: [
              { content: { contains: opts.query } },
              { title: { contains: opts.query } },
              { key: { contains: opts.query } },
            ],
          }
        : {}),
    },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
  });
  return rows.map((r) => toView(r, labels));
}

export async function memoryCounts(projectId: string): Promise<Record<string, number>> {
  const rows = await prisma.memoryEntry.groupBy({
    by: ["category"],
    where: { projectId, isCurrent: true },
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.category] = r._count._all;
  return counts;
}

export async function getMemoryEntry(id: string): Promise<MemoryEntryView | null> {
  const row = await prisma.memoryEntry.findUnique({ where: { id } });
  if (!row) return null;
  return toView(row, await chapterLabels(row.projectId));
}

/** 模型写入被「人工已修改」条目拦截时抛出，由提案服务转为 conflicted 状态。 */
export class HumanEditedError extends Error {
  constructor(message = "该条目已被人工修改，模型不得静默覆盖。") {
    super(message);
    this.name = "HumanEditedError";
  }
}

async function createVersion(
  projectId: string,
  input: MemoryInput,
  isUserEdited: boolean,
): Promise<MemoryEntryView> {
  assertStatusAllowed(input.category, input.status);
  const created = await prisma.memoryEntry.create({
    data: {
      projectId,
      category: input.category,
      key: input.key?.trim() || null,
      title: input.title?.trim() || null,
      content: input.content.trim(),
      status: input.status,
      sourceCitationsJson: JSON.stringify(input.citations ?? []),
      isUserEdited,
      revision: 1,
      isCurrent: true,
    },
  });
  return toView(created, await chapterLabels(projectId));
}

export async function createMemoryEntry(
  projectId: string,
  input: MemoryInput,
): Promise<MemoryEntryView> {
  return createVersion(projectId, input, true);
}

/** 模型新建条目：isUserEdited=false，后续模型运行可继续更新。 */
export async function createModelMemoryEntry(
  projectId: string,
  input: MemoryInput,
): Promise<MemoryEntryView> {
  return createVersion(projectId, input, false);
}

/** 找到同一条目版本链的当前头（沿 supersedesId 向后追溯）。 */
async function findHead(id: string): Promise<string> {
  let head = id;
  for (let guard = 0; guard < 1000; guard++) {
    const child = await prisma.memoryEntry.findFirst({
      where: { supersedesId: head },
      select: { id: true },
    });
    if (!child) break;
    head = child.id;
  }
  return head;
}

async function collectChainIds(headId: string): Promise<string[]> {
  const ids: string[] = [];
  let cur: string | null = headId;
  for (let guard = 0; cur && guard < 1000; guard++) {
    ids.push(cur);
    const row: { supersedesId: string | null } | null = await prisma.memoryEntry.findUnique({
      where: { id: cur },
      select: { supersedesId: true },
    });
    cur = row?.supersedesId ?? null;
  }
  return ids;
}

async function appendVersion(
  id: string,
  input: MemoryInput,
  isUserEdited: boolean,
): Promise<MemoryEntryView> {
  assertStatusAllowed(input.category, input.status);
  const headId = await findHead(id);
  const head = await prisma.memoryEntry.findUnique({ where: { id: headId } });
  if (!head) throw new Error("记忆条目不存在。");

  const next = {
    category: input.category,
    key: input.key?.trim() || null,
    title: input.title?.trim() || null,
    content: input.content.trim(),
    status: input.status,
    citationsJson: JSON.stringify(input.citations ?? []),
  };
  const unchanged =
    head.category === next.category &&
    head.key === next.key &&
    head.title === next.title &&
    head.content === next.content &&
    head.status === next.status &&
    head.sourceCitationsJson === next.citationsJson;
  if (unchanged) return toView(head, await chapterLabels(head.projectId));

  const created = await prisma.$transaction(async (tx) => {
    await tx.memoryEntry.update({ where: { id: head.id }, data: { isCurrent: false } });
    return tx.memoryEntry.create({
      data: {
        projectId: head.projectId,
        category: next.category,
        key: next.key,
        title: next.title,
        content: next.content,
        status: next.status,
        sourceCitationsJson: next.citationsJson,
        isUserEdited,
        revision: head.revision + 1,
        isCurrent: true,
        supersedesId: head.id,
      },
    });
  });
  return toView(created, await chapterLabels(head.projectId));
}

/**
 * 更新即生成新版本：旧版本保留为历史（isCurrent=false），人工修改不被静默覆盖。
 */
export async function updateMemoryEntry(
  id: string,
  input: MemoryInput,
): Promise<MemoryEntryView> {
  return appendVersion(id, input, true);
}

/**
 * 模型更新条目：若当前头已被人工修改（isUserEdited）则抛出 HumanEditedError，
 * 由提案服务标记为 conflicted 交给用户裁决，绝不静默覆盖。
 */
export async function updateModelMemoryEntry(
  id: string,
  input: MemoryInput,
): Promise<MemoryEntryView> {
  const headId = await findHead(id);
  const head = await prisma.memoryEntry.findUnique({ where: { id: headId } });
  if (!head) throw new Error("记忆条目不存在。");
  if (head.isUserEdited) throw new HumanEditedError();
  return appendVersion(head.id, input, false);
}

/** 按 (分类, 键) 查当前条目，用于判定提案是新增还是更新。 */
export async function findCurrentEntryByKey(
  projectId: string,
  category: MemoryCategory,
  key: string,
): Promise<MemoryEntryView | null> {
  const row = await prisma.memoryEntry.findFirst({
    where: { projectId, category, key, isCurrent: true },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) return null;
  return toView(row, await chapterLabels(projectId));
}

/** 历史版本（当前在前）。 */
export async function listMemoryHistory(id: string): Promise<MemoryEntryView[]> {
  const headId = await findHead(id);
  const head = await prisma.memoryEntry.findUnique({ where: { id: headId } });
  if (!head) return [];
  const labels = await chapterLabels(head.projectId);
  const ids = await collectChainIds(headId);
  const rows = await prisma.memoryEntry.findMany({ where: { id: { in: ids } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids.map((i) => byId.get(i)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  return ordered.map((r) => toView(r, labels));
}

export async function deleteMemoryEntry(id: string): Promise<void> {
  const headId = await findHead(id);
  const ids = await collectChainIds(headId);
  await prisma.memoryEntry.deleteMany({ where: { id: { in: ids } } });
}

/** 同一分类下多个「当前」条目共用同一 key 即为待审阅冲突。 */
export async function findKeyConflicts(projectId: string): Promise<KeyConflict[]> {
  const labels = await chapterLabels(projectId);
  const rows = await prisma.memoryEntry.findMany({
    where: { projectId, isCurrent: true, key: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const groupKey = `${r.category}::${r.key}`;
    const arr = groups.get(groupKey) ?? [];
    arr.push(r);
    groups.set(groupKey, arr);
  }
  const conflicts: KeyConflict[] = [];
  for (const [, arr] of groups) {
    if (arr.length > 1) {
      conflicts.push({
        category: arr[0].category as MemoryCategory,
        key: arr[0].key ?? "",
        entries: arr.map((r) => toView(r, labels)),
      });
    }
  }
  return conflicts;
}

/** 记忆工作台导出为 Markdown（章节笔记 + 各分类 + 出处）。 */
export async function exportMemoryMarkdown(projectId: string): Promise<string> {
  const project = await prisma.novelProject.findUnique({ where: { id: projectId } });
  if (!project) throw new Error("项目不存在。");
  const entries = await listMemoryEntries(projectId);

  const lines: string[] = [];
  lines.push(`# ${project.name} — 故事记忆`);
  lines.push("");
  lines.push(`导出时间：${new Date().toLocaleString("zh-CN")}`);
  lines.push("");

  for (const category of Object.keys(MEMORY_CATEGORY) as MemoryCategory[]) {
    const group = entries.filter((e) => e.category === category);
    if (group.length === 0) continue;
    lines.push(`## ${MEMORY_CATEGORY[category]}`);
    lines.push("");
    for (const e of group) {
      const heading = e.title || e.key || "（无标题）";
      lines.push(`### ${heading}`);
      lines.push(`- 状态：${e.status}`);
      if (e.key) lines.push(`- 键：${e.key}`);
      lines.push("");
      lines.push(e.content);
      if (e.citations.length > 0) {
        lines.push("");
        lines.push("出处：");
        for (const c of e.citations) {
          lines.push(`- 第 ${c.chapterIndex} 章《${c.chapterTitle}》${c.excerpt ? `：${c.excerpt}` : ""}`);
        }
      }
      lines.push("");
    }
  }
  return lines.join("\n") + "\n";
}
