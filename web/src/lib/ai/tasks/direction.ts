import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { NO_SOURCE_NOTE, NO_SOURCE_RULE, assertHasMemory } from "@/lib/ai/tasks/shared";
import { buildContinuationContext, renderContextBlock } from "@/lib/ai/context";
import { requestJson } from "@/lib/ai/structured";
import type { TaskDefinition, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "direction@1";

const candidate = z.object({
  direction: z.string().trim().min(1).max(300),
  summary: z.string().trim().min(1).max(1500),
  relatedThreads: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
});

const directionSchema = z.object({
  candidates: z.array(candidate).min(1).max(4),
});

export type DirectionOutput = z.infer<typeof directionSchema>;

const SYSTEM = [
  "你是一名小说策划，负责在既有故事之上提出可选的续写方向。",
  "硬性规则：",
  "1. 每个方向都必须扎根于既有记忆与最近原文，不得凭空引入新设定。",
  "2. 方向之间要真正不同：冲突来源、人物选择或叙事重心至少要有一处显著差异，不要给同一方向的三种说法。",
  "3. 只提出方向，不要写正文、不要排章纲。",
  "4. 不要替作者拍板，把选择权留给作者。",
  NO_SOURCE_RULE,
].join("\n");

const RETURN_FIELDS = [
  '{ "candidates": [{ "direction": string, "summary": string, "relatedThreads": [string] }] }',
].join("\n");

const FIELD_GUIDE = [
  "direction：方向名，一句话说清这个方向要往哪儿走（20 字以内为佳）。",
  "summary：200–400 字展开：核心冲突、主要人物的选择、与既有悬念的关系。",
  "relatedThreads：该方向主要承接的既有悬念或线索（用记忆里的标题）。",
].join("\n");

const SINGLE_UNIT: TaskUnit = { id: "directions", label: "续写方向" };

function buildPrompt(contextBlock: string): string {
  return [
    contextBlock,
    "",
    "请提出 3 个差异明显的续写方向，字段名与结构严格如下：",
    RETURN_FIELDS,
    "",
    FIELD_GUIDE,
    "",
    NO_SOURCE_NOTE,
  ].join("\n");
}

async function runUnit(_unit: TaskUnit, ctx: Parameters<TaskDefinition["runUnit"]>[1]) {
  const context = await buildContinuationContext(ctx.projectId, { lastN: 2 });
  const res = await requestJson(ctx.profile, {
    system: SYSTEM,
    prompt: buildPrompt(renderContextBlock(context)),
    schema: directionSchema,
    maxTokens: directionTask.maxTokens,
  });

  // 每个候选方向 = 一行 ContinuationPlan（draft），选定后由用户提升为 active。
  for (const c of res.data.candidates) {
    await prisma.continuationPlan.create({
      data: {
        projectId: ctx.projectId,
        direction: c.direction,
        summary: c.summary,
        relatedThreadsJson: JSON.stringify(c.relatedThreads),
        outlineJson: "[]",
        status: "draft",
        version: 1,
      },
    });
  }

  return { usage: res.usage, produced: res.data.candidates.length };
}

export const directionTask: TaskDefinition = {
  type: "direction",
  label: "生成续写方向",
  scope: "project",
  surface: "continuation",
  promptVersion: PROMPT_VERSION,
  maxTokens: 8192,
  async validate({ projectId }) {
    await assertHasMemory(projectId);
  },
  async listUnits() {
    return [SINGLE_UNIT];
  },
  runUnit,
  async describe({ projectId }) {
    const ctx = await buildContinuationContext(projectId, { lastN: 2 });
    return {
      unitCount: 1,
      unitLabel: "项",
      totalChars: ctx.totalChars,
      sampleText: ctx.memory.text.slice(0, 400),
      note: `依据 ${ctx.memory.entryCount} 条记忆与最近 ${ctx.recent.chapterTitles.length} 章原文，提出 3 个可选的续写方向（各写入一行候选，供你择一）。${NO_SOURCE_NOTE}`,
    };
  },
};
