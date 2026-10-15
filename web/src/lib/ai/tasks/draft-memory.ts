import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  NO_SOURCE_NOTE,
  NO_SOURCE_RULE,
  assertHasMemory,
  loadDraftRow,
  resolveDraftTargets,
} from "@/lib/ai/tasks/shared";
import { buildMemoryDigest, selectRecentText } from "@/lib/ai/context";
import { requestJson } from "@/lib/ai/structured";
import {
  createProposalsFromRun,
  deletePendingProposalsForDraft,
  reconcileDraftMemoryStatus,
} from "@/lib/ai/proposals";
import { parseOutlineItem } from "@/lib/continuation-view";
import { clampStatus } from "@/lib/ai/citations";
import { MEMORY_CATEGORY, type MemoryCategory, type MemoryStatus } from "@/lib/domain";
import type { ProposalDraft } from "@/lib/ai/types";
import type { TaskDefinition, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "draft-memory@1";

/** 记忆摘要的字符预算。 */
const MEMORY_BUDGET = 12_000;
/** 最近章节原文的字符预算。 */
const RECENT_BUDGET = 4_000;
/** 单次最多产出的记忆增量条目数。 */
const MAX_ITEMS = 20;

/** 草稿增量只产出这几类记忆；全书概要/文风/大纲不在其列。 */
const CATEGORIES = [
  "chapter-note",
  "character",
  "story-bible",
  "timeline",
  "thread",
  "glossary",
] as const;

const itemSchema = z.object({
  category: z.enum(CATEGORIES),
  /** 稳定键：人物用姓名、设定/术语用名称、悬念用标题；章节笔记留空由系统统一填。 */
  key: z.string().trim().max(120).default(""),
  title: z.string().trim().max(120).default(""),
  content: z.string().trim().min(1).max(2000),
  /** 仅当 category 为 thread 时使用（悬念的生命周期状态）。 */
  state: z.enum(["open", "advanced", "resolved", "uncertain"]).optional(),
});

const deltaSchema = z.object({
  items: z.array(itemSchema).max(MAX_ITEMS).default([]),
});

export type DraftMemoryOutput = z.infer<typeof deltaSchema>;

const SYSTEM = [
  "你是一名小说编辑，负责把一段续写草稿里的「新事实」沉淀为故事记忆，供后续章节续写时参考。",
  "你的唯一依据是用户提供的草稿正文与既有记忆。",
  "硬性规则：",
  "1. 只记录草稿正文里写出来的内容，不要引入草稿与记忆之外的设定或情节。",
  "2. 只记录「新出现」或「发生变化」的事实：新发生的事件、人物状态与关系的改变、新出现的设定与术语、推进或回收的悬念。既有记忆已经写明、草稿未改变的内容不必重复。",
  "3. 若某条目对应记忆里已有的同一条目（如同一个人物、同一处设定），沿用它在记忆里的标题作为 key，让它成为对该条目的更新，而不是新建重复条目。",
  "4. 一条一事；记不清或草稿没写清的，宁可不记。",
  NO_SOURCE_RULE,
].join("\n");

const RETURN_FIELDS = [
  '{ "items": [{',
  '    "category": "chapter-note|character|story-bible|timeline|thread|glossary",',
  '    "key": string, "title": string, "content": string,',
  '    "state": "open|advanced|resolved|uncertain" }] }',
].join("\n");

const FIELD_GUIDE = [
  `category：记忆分类（${CATEGORIES.map((c) => MEMORY_CATEGORY[c]).join(" / ")}）。`,
  "key：稳定标识，用于合并同类条目。人物用姓名、设定/术语用名称、悬念用标题；章节笔记留空字符串。",
  "title：条目标题。",
  "content：该条目的内容（新发生的事 / 新状态 / 新设定）。",
  "state：仅当 category 为 thread 时填悬念状态（open=未决 / advanced=推进中 / resolved=已回收 / uncertain=存疑），其它分类省略。",
].join("\n");

function buildPrompt(parts: {
  projectName: string;
  memory: string;
  recent: string;
  outline: string;
  draft: string;
}): string {
  const blocks = [
    `【作品】${parts.projectName}`,
    `【故事记忆】（既有事实；沿用同名标题的 key 即为更新）\n${parts.memory || "（暂无记忆条目）"}`,
  ];
  if (parts.recent) blocks.push(`【最近章节原文】\n${parts.recent}`);
  if (parts.outline) blocks.push(`【本章章纲】\n${parts.outline}`);
  blocks.push(`【待提取的续写草稿】\n${parts.draft}`);
  blocks.push(
    "",
    "请提取这段草稿相对既有记忆的增量，按下面的结构输出：",
    RETURN_FIELDS,
    "",
    FIELD_GUIDE,
    "",
    NO_SOURCE_NOTE,
    "",
    "没有值得一提的增量时，返回 {\"items\": []}。",
  );
  return blocks.join("\n");
}

type DraftRow = Awaited<ReturnType<typeof loadDraftRow>>;

const unitFor = (draft: DraftRow): TaskUnit => ({
  id: `memo-${draft.id}`,
  label: `第 ${draft.index} 章 · ${draft.title ?? "（无标题）"}`,
});

/** 条目状态：悬念用其生命周期状态，其余一律「推断」（草稿不是正典）。 */
function statusFor(category: MemoryCategory, state?: string): MemoryStatus {
  if (category === "thread") return clampStatus("thread", (state as MemoryStatus) ?? "open");
  return "inferred";
}

export function toProposals(draft: DraftRow, output: DraftMemoryOutput): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  for (const item of output.items) {
    if (!item.content.trim()) continue;
    // 章节笔记按草稿固定键归并，重跑时更新同一条而不是每章堆一条。
    const isNote = item.category === "chapter-note";
    drafts.push({
      category: item.category,
      key: isNote ? `draft:${draft.id}` : item.key.trim() || undefined,
      title: isNote
        ? `草稿笔记：第 ${draft.index} 章 · ${draft.title ?? "（无标题）"}`
        : item.title.trim() || undefined,
      content: item.content,
      status: statusFor(item.category, item.state),
      citations: [],
    });
  }
  return drafts;
}

async function runUnit(unit: TaskUnit, ctx: Parameters<TaskDefinition["runUnit"]>[1]) {
  const draft = await loadDraftRow(ctx.projectId, unit.id.replace(/^memo-/, ""));
  const [memory, recent, project] = await Promise.all([
    buildMemoryDigest(ctx.projectId, { charBudget: MEMORY_BUDGET }),
    selectRecentText(ctx.projectId, { lastN: 1, charBudget: RECENT_BUDGET }),
    prisma.novelProject.findUnique({ where: { id: ctx.projectId }, select: { name: true } }),
  ]);

  const outlineItem = parseOutlineItem(draft.outlineItemJson);
  const res = await requestJson(ctx.profile, {
    system: SYSTEM,
    prompt: buildPrompt({
      projectName: project?.name ?? "未命名作品",
      memory: memory.text,
      recent: recent.text,
      outline: outlineItem
        ? `第 ${outlineItem.index} 章《${outlineItem.title}》\n${outlineItem.summary}`
        : "",
      draft: `第 ${draft.index} 章《${draft.title ?? "（无标题）"}》\n\n${draft.content}`,
    }),
    schema: deltaSchema,
    maxTokens: draftMemoryTask.maxTokens,
  });

  const proposals = toProposals(draft, res.data);
  // 重跑前清掉上一轮尚未处置的提案；已采纳/忽略的历史保留。
  await deletePendingProposalsForDraft(draft.id);
  const created = await createProposalsFromRun(
    ctx.runId,
    ctx.projectId,
    proposals.map((p) => ({ chapterId: null, draftId: draft.id, draft: p })),
  );
  await reconcileDraftMemoryStatus(draft.id);

  return { usage: res.usage, produced: created };
}

export const draftMemoryTask: TaskDefinition = {
  type: "draft-memory",
  label: "提取记忆变化",
  scope: "project",
  surface: "continuation",
  promptVersion: PROMPT_VERSION,
  maxTokens: 4096,
  async validate({ projectId, payload }) {
    await assertHasMemory(projectId);
    await resolveDraftTargets(projectId, payload);
  },
  async listUnits({ projectId, payload }) {
    return (await resolveDraftTargets(projectId, payload)).map(unitFor);
  },
  runUnit,
  async describe({ projectId, payload }) {
    const [drafts, memory, recent] = await Promise.all([
      resolveDraftTargets(projectId, payload),
      buildMemoryDigest(projectId, { charBudget: MEMORY_BUDGET }),
      selectRecentText(projectId, { lastN: 1, charBudget: RECENT_BUDGET }),
    ]);
    return {
      unitCount: drafts.length,
      unitLabel: "章",
      totalChars: drafts.reduce((n, d) => n + d.content.length, 0) + memory.text.length + recent.text.length,
      sampleText: drafts[0]
        ? `第 ${drafts[0].index} 章《${drafts[0].title ?? "（无标题）"}》\n${drafts[0].content.slice(0, 120)}`
        : "",
      note: `逐章对照 ${memory.entryCount} 条记忆，提取草稿带来的新事件、人物变化、新设定与悬念进展，产出的提案均标为「推断」，需作者确认后才写入记忆。重新提取会替换该章上一次尚未处理的提案。`,
    };
  },
};
