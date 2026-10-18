import { CircleCheck, Loader2, AlertTriangle } from "lucide-react";
import { taskLabels, workflowProgress, type Workflow } from "./workflow-progress";
import type { ReactNode } from "react";

export function WorkflowProgressCard({ workflow, message, children }: { workflow: Workflow; message: string; children: ReactNode }) {
  const progress = workflowProgress(workflow);
  const running = workflow.status === "running" || workflow.status === "pending";
  const completed = workflow.status === "done";
  const Icon = running ? Loader2 : completed ? CircleCheck : AlertTriangle;
  const name = workflow.kind === "continue" ? "自动续写" : workflow.kind === "understand" ? "理解全书" : taskLabels[workflow.currentTask ?? ""] ?? "任务";
  if (workflow.kind === "single") return <section aria-label={`${workflow.projectName} · ${name}通知`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
    <div><p className="font-medium">{workflow.projectName} · {name}</p><p className="mt-1 text-muted-foreground">{message}</p></div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </section>;
  return <section aria-label={`${workflow.projectName} · ${name}进度`} className="workflow-progress space-y-4 rounded-xl border-2 bg-card p-5 shadow-sm" data-status={workflow.status}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className="workflow-progress-icon flex size-11 shrink-0 items-center justify-center rounded-xl"><Icon aria-hidden className={`size-6 ${running ? "animate-spin motion-reduce:animate-none" : ""}`} /></span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{workflow.projectName} · {name}</p>
          <p className="text-lg font-semibold" data-current-task={progress.currentTask}>{progress.saving ? "正在保存到作品库" : running ? taskLabels[progress.currentTask ?? ""] ?? "准备中" : completed ? "任务完成" : `${taskLabels[progress.currentTask ?? ""] ?? "任务"} · ${workflow.status === "stalled" ? "已中断" : "需要处理"}`}</p>
          <p className="text-sm text-muted-foreground">{progress.saving ? `${progress.stages.length} / ${progress.stages.length} 步已完成，正在保存` : running ? `第 ${progress.currentIndex + 1} / ${progress.stages.length} 步${progress.total > 0 ? ` · 本步已完成 ${progress.done} / ${progress.total} 项` : " · 正在准备"}` : message}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-3xl font-semibold tabular-nums tracking-tight" aria-hidden>{progress.percent}<span className="ml-0.5 text-base text-muted-foreground">%</span></span>
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
    <div role="progressbar" aria-label="整体任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={`${progress.percent}%，${completed ? "全部完成" : progress.saving ? "正在保存到作品库" : taskLabels[progress.currentTask ?? ""] ?? "准备中"}`} className="workflow-progress-track relative h-3 overflow-hidden rounded-full bg-muted">
      <div className="workflow-progress-fill absolute inset-0 origin-left rounded-full" style={{ transform: `scaleX(${progress.percent / 100})` }} />
      {running && <div aria-hidden className="workflow-progress-shimmer absolute inset-0" />}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>已完成 {progress.completed} / {progress.stages.length} 步</span>
      <span>{progress.saving ? "保存完成后可从作品库进入阅读" : running ? "流程自动推进，当前步骤会同步显示在下方" : completed ? "全部完成" : "进度已保留，可继续未完成部分"}</span>
    </div>
  </section>;
}
