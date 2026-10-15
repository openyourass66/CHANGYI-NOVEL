import "server-only";
import { prisma } from "@/lib/db";
import { listMemoryEntries } from "@/lib/memory";
import { MEMORY_CATEGORY, MEMORY_STATUS, type MemoryCategory } from "@/lib/domain";
import type { MemoryEntryView } from "@/lib/memory-view";

/** 记忆摘要的字符预算。 */
const DEFAULT_MEMORY_BUDGET = 12_000;
/** 最近章节原文的字符预算。 */
const DEFAULT_RECENT_BUDGET = 8_000;
/** 最近保留章的前部裁剪低于此长度时直接舍弃该章。 */
const MIN_TAIL_CHARS = 600;

/**
 * 记忆类别的渲染优先级。悬念、人物、设定是续写判断的主要依据，优先保留；
 * 逐章笔记体量最大、信息密度最低，排在最后，预算不足时先被舍弃。
 */
const CATEGORY_ORDER: MemoryCategory[] = [
  "summary",
  "thread",
  "character",
  "story-bible",
  "timeline",
  "style",
  "glossary",
  "outline",
  "chapter-note",
];

export type MemoryDigest = {
  text: string;
  entryCount: number;
  omittedCount: number;
};

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * 按类别渲染当前记忆条目为确定性文本（无向量检索）。超出预算时按类别优先级截断，
 * 被舍弃的条目计入 omittedCount，调用方可据此提示用户。
 */
export async function buildMemoryDigest(
  projectId: string,
  opts: { charBudget?: number } = {},
): Promise<MemoryDigest> {
  const budget = opts.charBudget ?? DEFAULT_MEMORY_BUDGET;
  const entries = await listMemoryEntries(projectId);
  if (entries.length === 0) return { text: "", entryCount: 0, omittedCount: 0 };

  const byCategory = new Map<MemoryCategory, MemoryEntryView[]>();
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? [];
    list.push(entry);
    byCategory.set(entry.category, list);
  }

  const blocks: string[] = [];
  let used = 0;
  let included = 0;
  let omitted = 0;

  for (const category of CATEGORY_ORDER) {
    const list = byCategory.get(category);
    if (!list || list.length === 0) continue;

    const lines: string[] = [];
    for (const entry of list) {
      const label = entry.title || entry.key || "（无标题）";
      const line = `- ${label}（${MEMORY_STATUS[entry.status]}）：${oneLine(entry.content)}`;
      if (used + line.length + 1 > budget) {
        omitted = entries.length - included;
        break;
      }
      lines.push(line);
      used += line.length + 1;
      included += 1;
    }
    if (lines.length > 0) {
      blocks.push(`## ${MEMORY_CATEGORY[category]}\n${lines.join("\n")}`);
    }
    if (omitted > 0) break;
  }

  return { text: blocks.join("\n\n"), entryCount: included, omittedCount: omitted };
}

export type RecentText = {
  text: string;
  chapterIds: string[];
  chapterTitles: string[];
  totalChars: number;
};

/**
 * 取最近 N 章原文，从最新往前累加。预算不足时保留最新的整章，并从最旧保留章的**前部**裁剪
 * （越靠近续写点越重要），裁剪后不足 MIN_TAIL_CHARS 则整章舍弃。
 */
export async function selectRecentText(
  projectId: string,
  opts: { lastN?: number; charBudget?: number } = {},
): Promise<RecentText> {
  const lastN = opts.lastN ?? 3;
  const budget = opts.charBudget ?? DEFAULT_RECENT_BUDGET;

  const rows = await prisma.chapter.findMany({
    where: { projectId },
    orderBy: { sortOrder: "desc" },
    take: lastN,
    select: { id: true, rawTitle: true, content: true },
  });

  const kept: { id: string; rawTitle: string; block: string }[] = [];
  let used = 0;

  for (const row of rows) {
    const header = `### ${row.rawTitle}`;
    const remaining = budget - used;
    const whole = `${header}\n${row.content}`;

    if (whole.length + 2 <= remaining) {
      kept.push({ id: row.id, rawTitle: row.rawTitle, block: whole });
      used += whole.length + 2;
      continue;
    }
    // 首章（最新章）即使超预算也保留，从其前部裁剪。
    const tailBudget = remaining - header.length - 20;
    if (kept.length === 0 || tailBudget >= MIN_TAIL_CHARS) {
      if (tailBudget >= MIN_TAIL_CHARS) {
        const tail = row.content.slice(row.content.length - tailBudget);
        kept.push({ id: row.id, rawTitle: row.rawTitle, block: `${header}\n（前文略）${tail}` });
      } else if (kept.length === 0) {
        kept.push({ id: row.id, rawTitle: row.rawTitle, block: whole });
      }
    }
    break;
  }

  kept.reverse();

  return {
    text: kept.map((k) => k.block).join("\n\n"),
    chapterIds: kept.map((k) => k.id),
    chapterTitles: kept.map((k) => k.rawTitle),
    totalChars: kept.reduce((sum, k) => sum + k.block.length, 0),
  };
}

export type ContinuationContext = {
  projectName: string;
  chapterTitles: { index: number; title: string }[];
  memory: MemoryDigest;
  recent: RecentText;
  totalChars: number;
};

/** 组装续写所需的全部上下文：章节目录 + 记忆摘要 + 最近原文。 */
export async function buildContinuationContext(
  projectId: string,
  opts: { lastN?: number; memoryBudget?: number; recentBudget?: number } = {},
): Promise<ContinuationContext> {
  const [project, chapters, memory, recent] = await Promise.all([
    prisma.novelProject.findUnique({ where: { id: projectId }, select: { name: true } }),
    prisma.chapter.findMany({
      where: { projectId },
      orderBy: { sortOrder: "asc" },
      select: { rawTitle: true },
    }),
    buildMemoryDigest(projectId, { charBudget: opts.memoryBudget }),
    selectRecentText(projectId, { lastN: opts.lastN, charBudget: opts.recentBudget }),
  ]);

  const chapterTitles = chapters.map((c, i) => ({ index: i + 1, title: c.rawTitle }));

  return {
    projectName: project?.name ?? "未命名作品",
    chapterTitles,
    memory,
    recent,
    totalChars: memory.text.length + recent.text.length,
  };
}

/** 将上下文渲染为提示词可嵌入的文本块。 */
export function renderContextBlock(ctx: ContinuationContext): string {
  const parts: string[] = [`【作品】${ctx.projectName}`];

  if (ctx.chapterTitles.length > 0) {
    parts.push(
      ["【章节目录】", ...ctx.chapterTitles.map((c) => `${c.index}. ${c.title}`)].join("\n"),
    );
  }
  parts.push(
    ctx.memory.text
      ? `【故事记忆】\n${ctx.memory.text}`
      : "【故事记忆】\n（暂无已确认的记忆条目）",
  );
  if (ctx.recent.text) {
    parts.push(`【最近章节原文】\n${ctx.recent.text}`);
  }
  if (ctx.memory.omittedCount > 0) {
    parts.push(`（注：记忆超长，已省略 ${ctx.memory.omittedCount} 条较次要条目。）`);
  }

  return parts.join("\n\n");
}
