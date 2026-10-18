"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  RotateCcw,
  Sparkles,
  Square,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ANALYSIS_STATUS,
  ANALYSIS_STATUS_TONE,
  RUN_STATUS,
  RUN_STATUS_TONE,
  toneClass,
  type Tone,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import type { RunStatusView } from "@/lib/ai/runner";
import {
  currentUnitOf,
  elapsedMs,
  formatElapsed,
  progressPct,
  unitDisplayName,
  unitStatusSummary,
} from "@/lib/ai/progress-view";

/** 逐项明细里每个单元的状态图标；用图标+文字，不靠颜色单独表意。 */
function UnitStatusIcon({ status, className }: { status: string; className?: string }) {
  if (status === "done") return <Check className={className} aria-hidden />;
  if (status === "analyzing") {
    return (
      <Loader2 className={cn(className, "animate-spin motion-reduce:animate-none")} aria-hidden />
    );
  }
  if (status === "failed") return <AlertTriangle className={className} aria-hidden />;
  return <span className={cn(className, "block size-1.5 rounded-full bg-current")} aria-hidden />;
}

const SUMMARY_CHIPS: { key: "done" | "analyzing" | "pending" | "failed"; label: string; tone: Tone }[] =
  [
    { key: "done", label: "已完成", tone: "success" },
    { key: "analyzing", label: "分析中", tone: "info" },
    { key: "pending", label: "待分析", tone: "muted" },
    { key: "failed", label: "失败", tone: "destructive" },
  ];

/**
 * 常驻的运行状态区：即使该步骤从未运行过也渲染，说明「还没跑过」，
 * 避免进度卡片忽隐忽现造成跳动。运行中显示当前单元、已用时与人话计数。
 */
export function RunStatusPanel({
  taskLabel,
  run,
  producedLabel = "条提案",
  idleHint = "这个步骤还没有运行过，配置好后点「开始」。",
  actions = null,
}: {
  taskLabel: string;
  run: RunStatusView | null;
  producedLabel?: string;
  idleHint?: string;
  actions?: { busy: boolean; onCancel: () => void; onResume: () => void } | null;
}) {
  const live = run?.status === "running" || run?.status === "pending";

  // 计时只在运行中推进；初值为 null，首帧渲染不读时间，避免服务端/客户端水合不一致。
  // 已结束的运行由 elapsedMs 用 finishedAt 计算，跟 now 无关。
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!live) return;
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick);
    const timer = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
    };
  }, [live]);

  // 展开状态：运行中默认展开，用户可覆盖。
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? Boolean(live);

  const currentRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    if (open && live) currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [open, live, run?.progress.currentUnitId]);

  if (!run) {
    return (
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">「{taskLabel}」运行状态</span>
          </div>
          <div className="mt-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {idleHint}
          </div>
        </CardContent>
      </Card>
    );
  }

  const pct = progressPct(run);
  const current = currentUnitOf(run);
  const summary = unitStatusSummary(run.units);
  const elapsed = formatElapsed(elapsedMs(run, now ?? 0));

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div
          className="flex flex-wrap items-start justify-between gap-3"
          role="status"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">「{taskLabel}」运行状态</span>
            <Badge variant="outline" className={toneClass(RUN_STATUS_TONE[run.status] ?? "muted")}>
              {RUN_STATUS[run.status as keyof typeof RUN_STATUS] ?? run.status}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {actions && live && (
              <Button variant="outline" size="sm" onClick={actions.onCancel} disabled={actions.busy}>
                <Square className="size-4" />
                取消
              </Button>
            )}
            {actions && (run.status === "failed" || run.status === "stalled") && (
              <Button variant="outline" size="sm" onClick={actions.onResume} disabled={actions.busy}>
                <RotateCcw className="size-4" />
                {run.status === "stalled" ? "继续" : "重试"}
              </Button>
            )}
          </div>
        </div>

        {/* 当前在做什么 + 人话计数 */}
        <div className="space-y-1 text-sm">
          {live && (
            <p className="flex items-center gap-1.5 font-medium">
              <Loader2
                className="size-3.5 shrink-0 animate-spin text-info motion-reduce:animate-none"
                aria-hidden
              />
              {current ? `正在处理 ${unitDisplayName(current)}` : "准备中…"}
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground tabular-nums">
            <span>
              已处理 {run.progress.unitsDone}/{run.progress.unitsTotal} {run.unitLabel}
            </span>
            <span>
              已产出 {run.progress.produced} {producedLabel}
            </span>
            {run.startedAt && (
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" aria-hidden />
                已用 {elapsed}
              </span>
            )}
          </p>
        </div>

        <Progress value={pct} aria-label={`运行进度 ${pct}%`} />

        <div className="flex flex-wrap items-center gap-1.5">
          {SUMMARY_CHIPS.filter((c) => summary[c.key] > 0).map((c) => (
            <Badge
              key={c.key}
              variant="outline"
              className={cn("gap-1 text-xs font-normal", toneClass(c.tone))}
            >
              {c.label} {summary[c.key]}
            </Badge>
          ))}
        </div>

        {run.status === "stalled" && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              处理进程已中断（应用可能重启过）。已完成的部分不会重做，点「继续」接着处理剩下的单元。
            </span>
          </div>
        )}

        {run.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <pre className="whitespace-pre-wrap font-sans">{run.error}</pre>
          </div>
        )}

        <div>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={open}
            onClick={() => setUserToggled(!open)}
          >
            <ChevronDown
              className={cn("size-4 transition-transform duration-150", open && "rotate-180")}
              aria-hidden
            />
            逐项明细（{run.units.length}）
          </Button>

          {open && (
            <ScrollArea className="mt-2 h-56 rounded-md border">
              <ul role="list" className="divide-y">
                {run.units.map((u) => {
                  const isCurrent = u.id === run.progress.currentUnitId;
                  return (
                    <li
                      key={u.id}
                      ref={isCurrent ? currentRef : undefined}
                      className={cn(
                        "flex items-center justify-between gap-2 px-3 py-2 text-sm",
                        isCurrent && "bg-info/5 ring-1 ring-inset ring-info/40",
                      )}
                    >
                      <span className="truncate">{unitDisplayName(u)}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 gap-1",
                          toneClass(ANALYSIS_STATUS_TONE[u.status] ?? "muted"),
                        )}
                      >
                        <UnitStatusIcon status={u.status} className="size-3" />
                        {ANALYSIS_STATUS[u.status as keyof typeof ANALYSIS_STATUS] ?? u.status}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
