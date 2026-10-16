import type { TaskRequirement, TaskSummary } from "@contracts/api";
export type { TaskRequirement, TaskSummary } from "@contracts/api";
import "server-only";
import { AnalysisError } from "@/lib/ai/errors";
import type { TaskDefinition, TaskSurface } from "@/lib/ai/tasks/types";
import { chapterExtractTask } from "@/lib/ai/tasks/chapter-extract";
import { bookSynthesisTask } from "@/lib/ai/tasks/book-synthesis";
import { directionTask } from "@/lib/ai/tasks/direction";
import { outlineTask } from "@/lib/ai/tasks/outline";
import { draftTask } from "@/lib/ai/tasks/draft";
import { continuityCheckTask } from "@/lib/ai/tasks/continuity-check";
import { draftMemoryTask } from "@/lib/ai/tasks/draft-memory";

/** 任务注册表：新增任务在此登记即可被运行器与预览识别。 */
export const TASKS: Record<string, TaskDefinition> = {
  [chapterExtractTask.type]: chapterExtractTask,
  [bookSynthesisTask.type]: bookSynthesisTask,
  [directionTask.type]: directionTask,
  [outlineTask.type]: outlineTask,
  [draftTask.type]: draftTask,
  [continuityCheckTask.type]: continuityCheckTask,
  [draftMemoryTask.type]: draftMemoryTask,
};

/**
 * 任务的硬前提。步骤轨据此显示「需先完成…」并在启动前提示；服务端 validate 仍是最终兜底。
 * - memory：需要已有记忆条目（逐章抽取的产物）
 * - plan：需要已有续写方向可选
 * - outline：所选方向需要有章纲
 * - drafts：所选方向需要有草稿
 */


/** 任务的可序列化摘要，供服务端页面传给客户端组件选择任务。 */


const TASK_DESCRIPTION: Record<string, string> = {
  "chapter-extract": "逐章理解原文，产出章节笔记、事件、人物、设定、悬念与术语提案。",
  "book-synthesis": "在已有记忆之上统合全书，产出概要、结局状态、未决线索与续写约束。",
  direction: "依据记忆与最近原文，提出 3 个差异明显的续写方向供你择一。",
  outline: "为已选定的方向排出接下来若干章的章纲，写入该方向并递增其版本。",
  draft: "按章纲逐章写出续写草稿，上一章会作为前情注入；草稿可人工编辑。",
  "continuity-check": "逐章核对续写草稿与既有记忆、原文是否自洽，产出「待核对」的问题与证据。",
  "draft-memory": "从续写草稿里提取相对既有记忆的增量，产出待确认的记忆提案。",
};

/** 各任务的硬前提；未列出的即为无前提。与 TASK_DESCRIPTION 同处集中声明。 */
const TASK_REQUIREMENT: Record<string, TaskRequirement | null> = {
  "chapter-extract": null,
  "book-synthesis": "memory",
  direction: "memory",
  outline: "plan",
  draft: "outline",
  "continuity-check": "drafts",
  "draft-memory": "drafts",
};

/** 列出某个入口可用任务；不同入口的启动参数不同（续写任务需要 planId）。 */
export function listTaskSummaries(surface: TaskSurface): TaskSummary[] {
  return Object.values(TASKS)
    .filter((task) => task.surface === surface)
    .map((task) => ({
      type: task.type,
      label: task.label,
      scope: task.scope,
      unitLabel: task.scope === "chapter" ? "章" : "项",
      description: TASK_DESCRIPTION[task.type] ?? "",
      requirement: TASK_REQUIREMENT[task.type] ?? null,
    }));
}

/** 某个入口覆盖的任务类型，用于按入口筛选历史运行。 */
export function listTaskTypes(surface: TaskSurface): string[] {
  return Object.values(TASKS)
    .filter((task) => task.surface === surface)
    .map((task) => task.type);
}

export function getTask(type: string): TaskDefinition {
  const task = TASKS[type];
  if (!task) throw new AnalysisError(`暂不支持的任务类型：${type}`);
  return task;
}

export function getTaskOrNull(type: string): TaskDefinition | null {
  return TASKS[type] ?? null;
}
