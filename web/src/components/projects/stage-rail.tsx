"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RUN_STATUS, toneClass, type Tone } from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { StageStatus } from "@/lib/ai/progress-view";

export type Stage = {
  key: string;
  label: string;
  description: string;
  status: StageStatus;
  /** 前置未完成时的提示。软门禁：步骤仍可选中，只用文字明示先后。 */
  hint?: string | null;
  /** 固定补充说明，如「已完成 · 产出 128」。 */
  meta?: string | null;
};

/** todo 只存在于步骤视图层，其余沿用领域里的运行状态文案。 */
const STATUS_LABEL: Record<StageStatus, string> = {
  todo: "未运行",
  running: RUN_STATUS.running,
  done: RUN_STATUS.done,
  failed: RUN_STATUS.failed,
  stalled: RUN_STATUS.stalled,
};

const STATUS_TONE: Record<StageStatus, Tone> = {
  todo: "muted",
  running: "info",
  done: "success",
  failed: "destructive",
  stalled: "warning",
};

function StatusIcon({ status, className }: { status: StageStatus; className?: string }) {
  if (status === "done") return <Check className={className} aria-hidden />;
  if (status === "running") {
    return (
      <Loader2 className={cn(className, "animate-spin motion-reduce:animate-none")} aria-hidden />
    );
  }
  if (status === "failed" || status === "stalled") {
    return <AlertTriangle className={className} aria-hidden />;
  }
  return <span className={cn(className, "block size-1.5 rounded-full bg-current")} aria-hidden />;
}

/**
 * 有序步骤轨。替代原先一排等价的「任务按钮」：用序号表达先后，用状态徽标回答
 * 「我在第几步、下一步是什么」。选中项带 aria-current="step"。
 */
export function StageRail({
  stages,
  activeKey,
  onSelect,
  disabled = false,
}: {
  stages: Stage[];
  activeKey: string;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <ol role="list" className="flex flex-wrap gap-2">
      {stages.map((stage, i) => {
        const active = stage.key === activeKey;
        return (
          <li key={stage.key} className="min-w-0 flex-1 basis-[13rem]">
            <button
              type="button"
              onClick={() => onSelect(stage.key)}
              disabled={disabled}
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex min-h-11 w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors duration-150",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active ? "border-ring bg-accent" : "border-border bg-card hover:bg-muted/60",
                disabled && "pointer-events-none opacity-60",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                  active ? "border-ring text-foreground" : "border-border text-muted-foreground",
                )}
                aria-hidden
              >
                {i + 1}
              </span>

              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-medium">{stage.label}</span>
                  <Badge
                    variant="outline"
                    // 不透明底色，让对比度不受选中态 bg-accent 影响。
                    className={cn("shrink-0 gap-1 bg-card", toneClass(STATUS_TONE[stage.status]))}
                  >
                    <StatusIcon status={stage.status} className="size-3" />
                    {STATUS_LABEL[stage.status]}
                  </Badge>
                </span>

                {stage.meta && (
                  <span className="block truncate text-xs text-muted-foreground">{stage.meta}</span>
                )}

                {stage.hint && (
                  // 同样自带不透明底色：选中态的 bg-accent 会压低 warning 的对比度。
                  <span className="flex items-start gap-1 rounded-md bg-card px-1.5 py-0.5 text-xs text-warning">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span>{stage.hint}</span>
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
