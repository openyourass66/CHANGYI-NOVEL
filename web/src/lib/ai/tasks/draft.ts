import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AnalysisError } from "@/lib/ai/errors";
import {
  NO_SOURCE_RULE,
  assertHasMemory,
  resolvePlanId,
} from "@/lib/ai/tasks/shared";
import { buildContinuationContext, renderContextBlock } from "@/lib/ai/context";
import { deletePendingProposalsForDraft } from "@/lib/ai/proposals";
import { requestJson } from "@/lib/ai/structured";
import { parseOutline, type OutlineItem } from "@/lib/continuation-view";
import { renderDirection } from "@/lib/continuation-direction";
import type { TaskDefinition, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "draft@2";

/** 上一章草稿作为「前情」注入的字符数（取结尾，越靠近本章越相关）。 */
const PREV_TAIL_CHARS = 1200;

const draftSchema = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(50),
});

export type DraftOutput = z.infer<typeof draftSchema>;

const SYSTEM = [
  "你是一名小说续写者，负责按既定章纲写出这一章的正文。",
  "硬性规则：",
  "1. 严格承接既有事实：已被记忆确立的人物状态、关系、规则与已发生事件不可推翻。",
  "2. 与「前情」保持连贯：时间、地点、在场人物、物件状态都要接得上。",
  "3. 只写这一章的内容，不要提前写后面章纲的事，也不要总结、预告或写作者按。",
  "4. 直接输出正文段落，不要写「本章」「第 X 章」之类的元信息，不要使用 Markdown 标记。",
  "5. 遵循方向说明中的人物选择、剧情目标、节奏和禁用情节，在本章章纲范围内落实，不要把未来构思误当作已发生事件。",
  NO_SOURCE_RULE,
].join("\n");

const RETURN_FIELDS = [
  '{ "title": string, "content": string }',
].join("\n");

const FIELD_GUIDE = [
  "title：本章标题（与章纲一致或更贴切，不超过 20 字）。",
  "content：本章正文，1800–3500 字，分自然段；只含正文本身。",
].join("\n");

type PlanWithOutline = {
  id: string;
  direction: string;
  summary: string | null;
  outline: OutlineItem[];
};

async function loadPlan(projectId: string, planId: string): Promise<PlanWithOutline> {
  const row = await prisma.continuationPlan.findFirst({ where: { id: planId, projectId } });
  if (!row) throw new AnalysisError("续写方向不存在。", 404);
  return {
    id: row.id,
    direction: row.direction,
    summary: row.summary,
    outline: parseOutline(row.outlineJson),
  };
}

/**
 * 待生成草稿的章纲条目：默认只取「还没有草稿」的章；指定 outlineIndex 时只取该章
 * （用于单章重新生成）。
 */
async function resolveTargets(
  projectId: string,
  planId: string,
  outlineIndex?: number,
): Promise<{ plan: PlanWithOutline; items: OutlineItem[] }> {
  const plan = await loadPlan(projectId, planId);
  if (plan.outline.length === 0) {
    throw new AnalysisError("这个方向还没有章纲，请先运行「生成章纲」。");
  }

  if (outlineIndex !== undefined) {
    const item = plan.outline.find((i) => i.index === outlineIndex);
    if (!item) throw new AnalysisError(`章纲里没有第 ${outlineIndex} 章。`);
    return { plan, items: [item] };
  }

  const existing = await prisma.draftChapter.findMany({
    where: { projectId, planId },
    select: { index: true },
  });
  const have = new Set(existing.map((e) => e.index));
  return { plan, items: plan.outline.filter((i) => !have.has(i.index)) };
}

function unitFor(item: OutlineItem): TaskUnit {
  return { id: `draft-${item.index}`, label: `第 ${item.index} 章 · ${item.title}` };
}

function buildPrompt(
  contextBlock: string,
  plan: PlanWithOutline,
  item: OutlineItem,
  index: number,
  prev: { title: string | null; content: string } | null,
): string {
  const parts = [
    contextBlock,
    "",
    renderDirection(plan),
    "",
    `【本章章纲（第 ${index} 章）】\n标题：${item.title}\n走向：${item.summary}`,
  ];
  if (item.beats.length > 0) {
    parts.push(`关键节拍：\n${item.beats.map((b) => `- ${b}`).join("\n")}`);
  }
  if (item.relatedThreads.length > 0) {
    parts.push(`承接线索：${item.relatedThreads.join("、")}`);
  }
  if (prev) {
    const tail = prev.content.slice(-PREV_TAIL_CHARS);
    parts.push(
      `【前情：上一章《${prev.title ?? `第 ${index - 1} 章`}》的结尾】\n（略）${tail}`,
    );
  }

  parts.push(
    "",
    "请写出这一章的正文，字段名与结构严格如下：",
    RETURN_FIELDS,
    "",
    FIELD_GUIDE,
    "",
    "注意：这是草稿，作者会人工编辑后再定稿。",
  );
  return parts.join("\n");
}

async function runUnit(unit: TaskUnit, ctx: Parameters<TaskDefinition["runUnit"]>[1]) {
  const planId = await resolvePlanId(ctx.projectId, ctx.payload.planId);
  const index = Number(unit.id.replace(/^draft-/, ""));
  const plan = await loadPlan(ctx.projectId, planId);
  const item = plan.outline.find((i) => i.index === index);
  if (!item) return { usage: {}, produced: 0, errors: [`章纲里没有第 ${index} 章。`] };

  const [context, prev] = await Promise.all([
    buildContinuationContext(ctx.projectId, { lastN: 3 }),
    prisma.draftChapter.findFirst({
      where: { projectId: ctx.projectId, planId, index: index - 1 },
      select: { title: true, content: true },
    }),
  ]);

  const res = await requestJson(ctx.profile, {
    system: SYSTEM,
    prompt: buildPrompt(
      renderContextBlock(context),
      plan,
      item,
      index,
      prev,
    ),
    schema: draftSchema,
    maxTokens: draftTask.maxTokens,
  });

  const data = {
    projectId: ctx.projectId,
    planId,
    index,
    title: res.data.title,
    content: res.data.content,
    outlineItemJson: JSON.stringify(item),
    // 正文已变，旧的记忆增量提案不再对应本章。
    memoryUpdateStatus: "none",
  };

  const existing = await prisma.draftChapter.findFirst({
    where: { projectId: ctx.projectId, planId, index },
    select: { id: true },
  });
  const draftId = existing
    ? (await prisma.draftChapter.update({
        where: { id: existing.id },
        data: { ...data, version: { increment: 1 } },
      })).id
    : (await prisma.draftChapter.create({ data })).id;
  // 正文被整章替换，上一轮提取的记忆提案不再对应本章，清掉尚未处置的部分。
  await deletePendingProposalsForDraft(draftId);

  return { usage: res.usage, produced: 1 };
}

export const draftTask: TaskDefinition = {
  type: "draft",
  label: "生成草稿",
  scope: "project",
  surface: "continuation",
  promptVersion: PROMPT_VERSION,
  // Anthropic 分支缺省 4096，正文需要更长，必须显式抬高。
  maxTokens: 8000,
  async validate({ projectId, payload }) {
    await assertHasMemory(projectId);
    const planId = await resolvePlanId(projectId, payload.planId);
    const { items } = await resolveTargets(projectId, planId, payload.outlineIndex);
    if (items.length === 0) {
      throw new AnalysisError("章纲里的每一章都已经有草稿了。");
    }
  },
  async listUnits({ projectId, payload }) {
    const planId = await resolvePlanId(projectId, payload.planId);
    const { items } = await resolveTargets(projectId, planId, payload.outlineIndex);
    return items.map(unitFor);
  },
  runUnit,
  async describe({ projectId, payload }) {
    const planId = await resolvePlanId(projectId, payload.planId);
    const [{ plan, items }, ctx] = await Promise.all([
      resolveTargets(projectId, planId, payload.outlineIndex),
      buildContinuationContext(projectId, { lastN: 3 }),
    ]);
    const withPrev = await prisma.draftChapter.count({
      where: { projectId, planId, index: { lt: items[0]?.index ?? 1 } },
    });
    return {
      unitCount: items.length,
      unitLabel: "章",
      totalChars: ctx.totalChars + renderDirection(plan).length,
      sampleText: items[0] ? `第 ${items[0].index} 章 · ${items[0].title}\n${items[0].summary}` : "",
      note: `依据方向「${plan.direction.slice(0, 40)}」、${ctx.memory.entryCount} 条记忆与最近 ${ctx.recent.chapterTitles.length} 章原文，逐章生成 ${items.length} 章草稿。${
        withPrev > 0 ? "已生成的上一章会作为「前情」注入。" : ""
      }草稿只写入续写区，原文与记忆不受影响。`,
    };
  },
};
