import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertHasMemory, loadDraftRow, resolveDraftTargets } from "@/lib/ai/tasks/shared";
import { selectRecentText } from "@/lib/ai/context";
import { locate } from "@/lib/ai/citations";
import { requestJson } from "@/lib/ai/structured";
import { replaceDraftIssues, type NewIssue } from "@/lib/continuation";
import { parseOutlineItem, type EvidenceRef } from "@/lib/continuation-view";
import { listMemoryEntries } from "@/lib/memory";
import { MEMORY_CATEGORY, MEMORY_STATUS } from "@/lib/domain";
import type { TaskDefinition, TaskRunCtx, TaskUnit } from "@/lib/ai/tasks/types";

export const PROMPT_VERSION = "continuity-check@1";

/** 记忆摘要的字符预算。 */
const MEMORY_BUDGET = 12_000;
/** 最近章节原文的字符预算。 */
const RECENT_BUDGET = 6_000;
/** 单次检查最多产出的问题数。 */
const MAX_ISSUES = 12;

const CATEGORIES = ["时间", "因果", "设定", "人物认知", "视角", "顺序", "其他"] as const;

const issueSchema = z.object({
  category: z.enum(CATEGORIES),
  severity: z.enum(["info", "warning", "error"]),
  description: z.string().trim().min(1).max(600),
  /** 草稿中的原文片段，用于在正文里定位并高亮。 */
  draftExcerpts: z.array(z.string().trim().min(2).max(300)).max(4).default([]),
  /** 相关的记忆条目编号（见提示词里的 [M1]、[M2]…）。 */
  memoryRefs: z.array(z.string().trim().max(16)).max(6).default([]),
});

const checkSchema = z.object({
  issues: z.array(issueSchema).max(MAX_ISSUES).default([]),
});

export type ContinuityCheckOutput = z.infer<typeof checkSchema>;

const SYSTEM = [
  "你是一名小说编辑，负责核对一段续写草稿与作品既有事实是否自洽。",
  "硬性规则：",
  "1. 只报告「草稿与已有记忆/原文明确冲突」或「草稿内部明确自相矛盾」之处，不要提风格意见、不要夸奖、不要提建议性改写。",
  "2. 每一条都必须给出草稿中的原文片段（draftExcerpts）作为证据，片段要能在草稿里逐字找到。",
  "3. 若冲突与某条记忆有关，在 memoryRefs 里填该记忆的编号（如 [M3] 就填 \"M3\"）。",
  "4. 没有把握就不要报。宁可少报，也不要制造需要人工排除的噪音。",
  "5. 一条问题只讲一件事。",
].join("\n");

const RETURN_FIELDS = [
  '{ "issues": [{ "category": "时间|因果|设定|人物认知|视角|顺序|其他",',
  '    "severity": "info|warning|error", "description": string,',
  '    "draftExcerpts": [string], "memoryRefs": [string] }] }',
].join("\n");

const FIELD_GUIDE = [
  "category：问题类型。severity：严重程度，error 用于硬性事实冲突，warning 用于可疑之处，info 用于待确认的细节。",
  "description：一句话说清冲突是什么（谁/在哪/与什么冲突）。",
  "draftExcerpts：草稿里能佐证该问题的原文片段（逐字摘录，2–4 条）。",
  "memoryRefs：相关记忆条目的编号（如 M3），没有就留空数组。",
].join("\n");

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** 带稳定编号 [M1]、[M2]… 的记忆摘要，便于模型在 memoryRefs 里回指。 */
async function buildNumberedMemory(projectId: string): Promise<{
  text: string;
  entryCount: number;
  idByRef: Map<string, string>;
}> {
  const entries = await listMemoryEntries(projectId);
  const idByRef = new Map<string, string>();
  const lines: string[] = [];
  let used = 0;
  let included = 0;

  for (const entry of entries) {
    const ref = `M${included + 1}`;
    const label = entry.title || entry.key || "（无标题）";
    const line = `[${ref}] ${MEMORY_CATEGORY[entry.category]}｜${label}（${MEMORY_STATUS[entry.status]}）：${oneLine(entry.content)}`;
    if (used + line.length + 1 > MEMORY_BUDGET) break;
    lines.push(line);
    idByRef.set(ref, entry.id);
    used += line.length + 1;
    included += 1;
  }

  return { text: lines.join("\n"), entryCount: included, idByRef };
}

function buildPrompt(parts: {
  projectName: string;
  memory: string;
  recent: string;
  outline: string;
  draft: string;
}): string {
  const blocks = [
    `【作品】${parts.projectName}`,
    `【故事记忆】（编号 M1、M2… 可供 memoryRefs 引用）\n${parts.memory || "（暂无记忆条目）"}`,
  ];
  if (parts.recent) blocks.push(`【最近章节原文】\n${parts.recent}`);
  if (parts.outline) blocks.push(`【本章章纲】\n${parts.outline}`);
  blocks.push(`【待检查的续写草稿】\n${parts.draft}`);
  blocks.push(
    "",
    "请核对上述草稿是否与记忆、原文或自身前后一致，按下面的结构输出问题：",
    RETURN_FIELDS,
    "",
    FIELD_GUIDE,
    "",
    "没有发现冲突时，返回 {\"issues\": []}。",
  );
  return blocks.join("\n\n");
}

type DraftRow = Awaited<ReturnType<typeof loadDraftRow>>;

const unitFor = (draft: DraftRow): TaskUnit => ({
  id: `check-${draft.id}`,
  label: `第 ${draft.index} 章 · ${draft.title ?? "（无标题）"}`,
});

function unitTitle(draft: DraftRow): string {
  return `第 ${draft.index} 章《${draft.title ?? "（无标题）"}》`;
}

function buildEvidence(
  draft: DraftRow,
  excerpts: string[],
  refs: string[],
  idByRef: Map<string, string>,
): EvidenceRef[] {
  const evidence: EvidenceRef[] = [];
  for (const excerpt of excerpts) {
    const found = locate(draft.content, excerpt);
    evidence.push({
      kind: "draft",
      draftId: draft.id,
      excerpt: excerpt.slice(0, 200),
      ...(found ? { startOffset: found.start, endOffset: found.end } : {}),
    });
  }
  for (const ref of refs) {
    const entryId = idByRef.get(ref.toUpperCase());
    if (entryId) evidence.push({ kind: "memory", entryId });
  }
  return evidence;
}

async function runUnit(unit: TaskUnit, ctx: TaskRunCtx) {
  const draft = await loadDraftRow(ctx.projectId, unit.id.replace(/^check-/, ""));
  const [memory, recent, project] = await Promise.all([
    buildNumberedMemory(ctx.projectId),
    selectRecentText(ctx.projectId, { lastN: 3, charBudget: RECENT_BUDGET }),
    prisma.novelProject.findUnique({
      where: { id: ctx.projectId },
      select: { name: true },
    }),
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
      draft: `${unitTitle(draft)}\n\n${draft.content}`,
    }),
    schema: checkSchema,
    maxTokens: continuityCheckTask.maxTokens,
  });

  const issues: NewIssue[] = res.data.issues.map((issue) => ({
    category: issue.category,
    severity: issue.severity,
    description: issue.description,
    evidence: buildEvidence(draft, issue.draftExcerpts, issue.memoryRefs, memory.idByRef),
  }));

  await replaceDraftIssues(draft.id, issues);
  await prisma.draftChapter.update({
    where: { id: draft.id },
    data: {
      continuityCheckJson: JSON.stringify({
        checkedAt: new Date().toISOString(),
        runId: ctx.runId,
        promptVersion: PROMPT_VERSION,
        issueCount: issues.length,
      }),
    },
  });

  // 未能在正文中定位的片段照旧保留（只是不能高亮跳转），不记为 error：运行器的
  // errors 会计入「整轮失败」的判定，也不会被当成致命错误。证据本身的可用性已足够表达。
  return { usage: res.usage, produced: issues.length };
}

export const continuityCheckTask: TaskDefinition = {
  type: "continuity-check",
  label: "检查连续性",
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
      buildNumberedMemory(projectId),
      selectRecentText(projectId, { lastN: 3, charBudget: RECENT_BUDGET }),
    ]);
    return {
      unitCount: drafts.length,
      unitLabel: "章",
      totalChars: drafts.reduce((n, d) => n + d.content.length, 0) + memory.text.length + recent.text.length,
      sampleText: drafts[0] ? `${unitTitle(drafts[0])}\n${drafts[0].content.slice(0, 120)}` : "",
      note: `逐章核对续写草稿与 ${memory.entryCount} 条记忆、最近 ${recent.chapterTitles.length} 章原文是否自洽，产出的问题均标为「待核对」，不会改动草稿本身。重新检查会替换该章上一次的检查结果。`,
    };
  },
};
