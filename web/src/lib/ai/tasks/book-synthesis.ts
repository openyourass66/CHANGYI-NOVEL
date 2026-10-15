import "server-only";
import { z } from "zod";
import { NO_SOURCE_NOTE, NO_SOURCE_RULE, assertHasMemory } from "@/lib/ai/tasks/shared";
import { buildContinuationContext, renderContextBlock } from "@/lib/ai/context";
import { requestJson } from "@/lib/ai/structured";
import { createProposalsFromRun } from "@/lib/ai/proposals";
import type { ProposalDraft } from "@/lib/ai/types";
import type { TaskDefinition, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "book-synthesis@1";

const listItem = z.object({
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().min(1).max(1200),
});

const synthesisSchema = z.object({
  overview: z.string().trim().min(1).max(2000),
  endingState: z.string().trim().min(1).max(2000),
  unresolved: z.array(listItem).max(40).default([]),
  constraints: z.array(z.string().trim().min(1).max(600)).max(40).default([]),
  choices: z.array(z.string().trim().min(1).max(600)).max(40).default([]),
  ambiguities: z.array(z.string().trim().min(1).max(600)).max(40).default([]),
});

export type BookSynthesisOutput = z.infer<typeof synthesisSchema>;

const SYSTEM = [
  "你是一名严谨的小说编辑，负责在全书抽取结果之上做「统合」判断，为后续续写做准备。",
  "你的唯一依据是用户提供的章节标题、故事记忆与最近原文。",
  "硬性规则：",
  "1. 不得引入原文与记忆之外的设定、人物或情节。",
  "2. 严格区分「明述」与「推断」：记忆标注为「推断」的内容，统合时也必须表述为推断。",
  "3. 结局状态只描述文本已经到达的状态，不替作者规划未来。",
  "4. 拿不准的留白写成「实质歧义」，不要替作者拍板。",
  NO_SOURCE_RULE,
].join("\n");

const RETURN_FIELDS = [
  '{ "overview": string,',
  '  "endingState": string,',
  '  "unresolved": [{ "title": string, "detail": string }],',
  '  "constraints": [string],',
  '  "choices": [string],',
  '  "ambiguities": [string] }',
].join("\n");

const FIELD_GUIDE = [
  "overview：全书概要。用 3–6 句话概括主线、核心人物与当前格局。",
  "endingState：结局状态。截至最新一章，主角处境、主要关系与核心悬念各处于什么状态。",
  "unresolved：未决线索。仍未回收的悬念，逐条给出 title 与 detail。",
  "constraints：续写约束。续写时必须遵守的既定事实（人物设定、已确立的规则、已发生的事件）。",
  "choices：开放选择。文本尚未锁定、作者可以自由决定的方向。",
  "ambiguities：实质歧义。原文本身存在矛盾或含糊、需要作者裁决的问题。",
];

function bulletList(items: string[]): string {
  return items.map((s) => `- ${s}`).join("\n");
}

/** 将统合结果映射为 summary 类别提案草稿；空条目直接跳过，不产出空提案。 */
export function toProposals(output: BookSynthesisOutput): ProposalDraft[] {
  const drafts: ProposalDraft[] = [];
  const push = (key: string, title: string, content: string) => {
    if (!content.trim()) return;
    drafts.push({ category: "summary", key, title, content, status: "inferred", citations: [] });
  };

  push("synthesis:overview", "全书概要", output.overview);
  push("synthesis:ending-state", "结局状态", output.endingState);
  push(
    "synthesis:unresolved",
    "未决线索",
    output.unresolved.map((u) => `- ${u.title}：${u.detail}`).join("\n"),
  );
  push("synthesis:constraints", "续写约束", bulletList(output.constraints));
  push("synthesis:choices", "开放选择", bulletList(output.choices));
  push("synthesis:ambiguities", "实质歧义", bulletList(output.ambiguities));

  return drafts;
}

const SINGLE_UNIT: TaskUnit = { id: "synthesis", label: "全书统合" };

function buildPrompt(contextBlock: string): string {
  return [
    contextBlock,
    "",
    "请统合以上内容，字段名与结构严格如下：",
    RETURN_FIELDS,
    "",
    ...FIELD_GUIDE,
    "",
    NO_SOURCE_NOTE,
  ].join("\n");
}

async function runUnit(_unit: TaskUnit, ctx: Parameters<TaskDefinition["runUnit"]>[1]) {
  const context = await buildContinuationContext(ctx.projectId, { lastN: 1 });
  const res = await requestJson(ctx.profile, {
    system: SYSTEM,
    prompt: buildPrompt(renderContextBlock(context)),
    schema: synthesisSchema,
    maxTokens: bookSynthesisTask.maxTokens,
  });
  const drafts = toProposals(res.data);
  const created = await createProposalsFromRun(
    ctx.runId,
    ctx.projectId,
    drafts.map((draft) => ({ chapterId: null, draft })),
  );
  return { usage: res.usage, produced: created };
}

export const bookSynthesisTask: TaskDefinition = {
  type: "book-synthesis",
  label: "全书统合",
  scope: "project",
  surface: "analysis",
  promptVersion: PROMPT_VERSION,
  maxTokens: 4096,
  async validate({ projectId }) {
    await assertHasMemory(projectId);
  },
  async listUnits() {
    return [SINGLE_UNIT];
  },
  runUnit,
  async describe({ projectId }) {
    const ctx = await buildContinuationContext(projectId, { lastN: 1 });
    return {
      unitCount: 1,
      unitLabel: "项",
      totalChars: ctx.totalChars,
      sampleText: ctx.memory.text.slice(0, 400),
      note: `统合 ${ctx.memory.entryCount} 条记忆与 ${ctx.chapterTitles.length} 个章节标题，产出全书概要、结局状态、未决线索、续写约束、开放选择与实质歧义。${NO_SOURCE_NOTE}`,
    };
  },
};
