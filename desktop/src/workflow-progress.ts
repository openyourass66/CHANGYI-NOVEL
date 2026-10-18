import type { AutomaticContinuationProgress } from "@/lib/continuation-view";

export type Workflow = AutomaticContinuationProgress & {
  projectId: string;
  projectName: string;
  kind: string;
  workId?: string;
  error?: string;
  notified: number;
  sound: boolean;
  updatedAt?: string;
};

export const taskLabels: Record<string, string> = {
  "chapter-extract": "逐章理解", "book-synthesis": "全书统合", outline: "生成章纲",
  draft: "生成草稿", "continuity-check": "检查连续性", "draft-memory": "提取记忆变化", direction: "确定续写方向",
};
export const continuationStages = ["direction", "outline", "draft", "continuity-check", "draft-memory"];

export function workflowProgress(workflow: Workflow) {
  const steps = workflow.steps ?? [];
  const stages = workflow.kind === "continue" ? continuationStages : steps.length ? steps.map((step) => step.taskType) : [workflow.currentTask ?? ""];
  const currentTask = workflow.currentTask;
  const currentIndex = Math.max(0, stages.indexOf(currentTask ?? ""));
  const run = workflow.run?.taskType === currentTask ? workflow.run : null;
  const total = Math.max(0, run?.progress.unitsTotal ?? 0);
  const done = Math.max(0, Math.min(total, run?.progress.unitsDone ?? 0));
  const finished = workflow.status === "done";
  const saving = workflow.kind === "continue" && workflow.status === "running" && steps.length > 0 && (workflow.step ?? 0) >= steps.length;
  const completed = finished || saving ? stages.length : currentIndex;
  const fraction = total > 0 ? done / total : 0;
  const percent = finished ? 100 : Math.min(99, Math.floor(((completed + fraction) / stages.length) * 100));
  return { currentTask, currentIndex, stages, total, done, completed, percent, saving, indeterminate: !total };
}
