import type { ChatUsage } from "./types";
import type { RunPayload } from "./tasks/types";

type Progress = {
  batchIndex: number;
  batchTotal: number;
  unitsDone: number;
  unitsTotal: number;
  produced: number;
  errors: string[];
  /** 本次任务已处理的单元，用于中断后 resume 时避免重复处理（不影响新任务重跑）。 */
  doneIds: string[];
  /** 本次任务处理失败的单元；恢复时只重新处理这些单元。旧运行记录可能缺少此字段。 */
  failedIds: string[];
  /** 正在处理的单元，供前端显示「正在处理第 N 章…」；空闲时为 null。 */
  currentUnitId: string | null;
  currentLabel: string | null;
};

export type RunUnitView = {
  id: string;
  index: number;
  label: string;
  chapterId: string | null;
  status: string;
};

export type RunStatusView = {
  id: string;
  projectId: string;
  taskType: string;
  taskLabel: string;
  /** 单元量词（逐章＝章，整项目＝项）。 */
  unitLabel: string;
  /** pending | running | done | failed | canceled，另有视图层的 stalled（running 但处理器已失联）。 */
  status: string;
  progress: Progress;
  usage: ChatUsage;
  error: string | null;
  promptVersion: string | null;
  authorizedAt: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  payload: RunPayload;
  units: RunUnitView[];
};
