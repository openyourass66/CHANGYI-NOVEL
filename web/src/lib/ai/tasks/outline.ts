import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { AnalysisError } from "@/lib/ai/errors";
import {
  NO_SOURCE_NOTE,
  NO_SOURCE_RULE,
  assertHasMemory,
  resolvePlanId,
} from "@/lib/ai/tasks/shared";
import { buildContinuationContext, renderContextBlock } from "@/lib/ai/context";
import { requestJson } from "@/lib/ai/structured";
import { updatePlan } from "@/lib/continuation";
import type { OutlineItem } from "@/lib/continuation-view";
import type { TaskDefinition, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "outline@1";

/** 默认规划的章节数；调用方可经 payload.outlineCount 覆盖。 */
const DEFAULT_OUTLINE_COUNT = 5;

const outlineItem = z.object({
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1200),
  beats: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
  relatedThreads: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});

const outlineSchema = z.object({
  chapters: z.array(outlineItem).min(1).max(30),
  notes: z.string().trim().max(1000).default(""),
});

export type OutlineOutput = z.infer<typeof outlineSchema>;

const SYSTEM = [
  "你是一名小说结构师，负责为已经选定的续写方向排出接下来若干章的章纲。",
  "硬性规则：",
  "1. 严格服务于给定方向，不得偏离到别的走向。",
  "2. 每一章都要推进方向中的核心冲突，不要写可有可无的过渡章。",
  "3. 承认既有事实：已被记忆确立的人物状态、规则与已发生事件不可推翻。",
  "4. 只排章纲，不要写章节正文。",
  NO_SOURCE_RULE,
].join("\n");

const RETURN_FIELDS = [
  '{ "chapters": [{ "title": string, "summary": string, "beats": [string], "relatedThreads": [string] }],',
  '  "notes": string }',
].join("\n");

const FIELD_GUIDE = [
  "chapters：按顺序排列的章节，每章给出 title（章标题）、summary（一章的走向，100–300 字）、beats（该章要推进的关键节拍，3–6 条）、relatedThreads（该章承接的既有线索）。",
  "notes：整体说明，交代这一批章纲如何服务于选定方向（可留空字符串）。",
].join("\n");

const SINGLE_UNIT: TaskUnit = { id: "outline", label: "章纲" };

async function buildPrompt(
  contextBlock: string,
  direction: string,
  count: number,
): Promise<string> {
  return [
    contextBlock,
    "",
    `【已选定的续写方向】\n${direction}`,
    "",
    `请为这个方向排出接下来 ${count} 章的章纲，字段名与结构严格如下：`,
    RETURN_FIELDS,
    "",
    FIELD_GUIDE,
    "",
    NO_SOURCE_NOTE,
  ].join("\n");
}

async function runUnit(_unit: TaskUnit, ctx: Parameters<TaskDefinition["runUnit"]>[1]) {
  const planId = await resolvePlanId(ctx.projectId, ctx.payload.planId);
  const plan = await prisma.continuationPlan.findUnique({
    where: { id: planId },
    select: { direction: true },
  });
  if (!plan) return { usage: {}, produced: 0 };

  const count = ctx.payload.outlineCount ?? DEFAULT_OUTLINE_COUNT;
  const context = await buildContinuationContext(ctx.projectId, { lastN: 2 });
  const res = await requestJson(ctx.profile, {
    system: SYSTEM,
    prompt: await buildPrompt(renderContextBlock(context), plan.direction, count),
    schema: outlineSchema,
    maxTokens: outlineTask.maxTokens,
  });

  const outline: OutlineItem[] = res.data.chapters.map((c, i) => ({
    index: i + 1,
    title: c.title,
    summary: c.summary,
    beats: c.beats,
    relatedThreads: c.relatedThreads,
  }));
  // 覆盖写入所选方向的章纲；updatePlan 会递增 version，便于草稿追溯所依据的章纲版本。
  await updatePlan(planId, { outline });

  return { usage: res.usage, produced: outline.length };
}

export const outlineTask: TaskDefinition = {
  type: "outline",
  label: "生成章纲",
  scope: "project",
  surface: "continuation",
  promptVersion: PROMPT_VERSION,
  maxTokens: 8192,
  async validate({ projectId, payload }) {
    await assertHasMemory(projectId);
    const planId = await resolvePlanId(projectId, payload.planId);
    const draftCount = await prisma.draftChapter.count({ where: { projectId, planId } });
    if (draftCount > 0) {
      throw new AnalysisError(
        "这个方向已有草稿，不能直接重生成章纲。请先导出需要保留的草稿，再删除该方向的草稿后重试。",
      );
    }
  },
  async listUnits() {
    return [SINGLE_UNIT];
  },
  runUnit,
  async describe({ projectId, payload }) {
    const planId = await resolvePlanId(projectId, payload.planId);
    const [plan, ctx] = await Promise.all([
      prisma.continuationPlan.findUnique({ where: { id: planId }, select: { direction: true } }),
      buildContinuationContext(projectId, { lastN: 2 }),
    ]);
    const count = payload.outlineCount ?? DEFAULT_OUTLINE_COUNT;
    return {
      unitCount: 1,
      unitLabel: "项",
      totalChars: ctx.totalChars,
      sampleText: plan?.direction ?? "",
      note: `依据方向「${plan?.direction ?? ""}」与 ${ctx.memory.entryCount} 条记忆，规划接下来 ${count} 章的章纲，写入该方向并使其版本号 +1。${NO_SOURCE_NOTE}`,
    };
  },
};
