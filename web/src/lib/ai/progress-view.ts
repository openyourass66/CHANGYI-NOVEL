/**
 * 运行进度的纯展示派生。与运行器解耦、无副作用，便于在 mock 端到端脚本里直接断言，
 * 也让两个面板共用同一套「进度怎么说人话」的逻辑。
 */
import type { RunStatusView, RunUnitView } from "@/lib/ai/runner";

/** 步骤在轨道上的状态。stalled＝视图层的「进程失联但 DB 仍是 running」。 */
export type StageStatus = "todo" | "running" | "done" | "failed" | "stalled";

export function stageStatusOf(run: RunStatusView | null | undefined): StageStatus {
  if (!run) return "todo";
  switch (run.status) {
    case "running":
    case "pending":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    case "stalled":
      return "stalled";
    default:
      // canceled：视为未完成但可重跑
      return "todo";
  }
}

export function progressPct(run: RunStatusView | null | undefined): number {
  const p = run?.progress;
  if (!p || p.unitsTotal <= 0) return 0;
  return Math.min(100, Math.round((p.unitsDone / p.unitsTotal) * 100));
}

/** 毫秒 → `mm:ss`（超过一小时为 `h:mm:ss`）。 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 已用时：startedAt → finishedAt（未结束时用传入的 now）。 */
export function elapsedMs(run: RunStatusView, now: number): number {
  const start = run.startedAt ? Date.parse(run.startedAt) : Number.NaN;
  if (Number.isNaN(start)) return 0;
  const end = run.finishedAt ? Date.parse(run.finishedAt) : now;
  return Math.max(0, (Number.isNaN(end) ? now : end) - start);
}

export type UnitSummary = { done: number; analyzing: number; pending: number; failed: number };

export function unitStatusSummary(units: RunUnitView[]): UnitSummary {
  const s: UnitSummary = { done: 0, analyzing: 0, pending: 0, failed: 0 };
  for (const u of units) {
    if (u.status === "done") s.done += 1;
    else if (u.status === "analyzing") s.analyzing += 1;
    else if (u.status === "failed") s.failed += 1;
    else s.pending += 1;
  }
  return s;
}

/** 逐章单元显示「第 N 章 · 标题」，整项目单元直接显示标签。 */
export function unitDisplayName(unit: RunUnitView): string {
  return unit.chapterId ? `第 ${unit.index} 章 · ${unit.label}` : unit.label;
}

/** 当前正在处理的单元；不在推进中则为 null。 */
export function currentUnitOf(run: RunStatusView | null | undefined): RunUnitView | null {
  const id = run?.progress.currentUnitId;
  if (!id) return null;
  return run.units.find((u) => u.id === id) ?? null;
}

/** 步骤轨上的补充说明（用固定文案，避免渲染时取当前时间导致水合不一致）。 */
export function stageMetaOf(run: RunStatusView | null | undefined): string | null {
  if (!run) return null;
  switch (run.status) {
    case "running":
    case "pending":
      return "进行中…";
    case "done":
      return `已完成${run.progress.produced > 0 ? ` · 产出 ${run.progress.produced}` : ""}`;
    case "failed":
      return "上次失败";
    case "stalled":
      return "上次中断";
    default:
      return "上次已取消";
  }
}
