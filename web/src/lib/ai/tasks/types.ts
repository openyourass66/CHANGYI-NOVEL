import type { TaskScope, TaskSurface, RunPayload, TaskUnit } from "@contracts/api";
export type { TaskScope, TaskSurface, RunPayload, TaskUnit } from "@contracts/api";
/** 任务定义的类型契约。纯类型模块，便于任务定义与运行器共享。 */
import type { ChatUsage, ResolvedProfile } from "@/lib/ai/types";

/** 任务作用域：逐章（一单元一章）或整项目（单元由任务自定义）。 */


/** 任务入口：理解分析页或续写规划页。决定任务在哪个面板里被选择与启动。 */


/** 运行载荷，序列化存入 AnalysisRun.inputRangeJson.payload。 */


/** 一个处理单元。逐章任务的单元即章节；整项目任务的单元由任务自定义。 */


/** 建 run 前的上下文（尚无 runId）。 */
export type TaskSetupCtx = {
  projectId: string;
  payload: RunPayload;
};

/** 处理单元时的上下文。 */
export type TaskRunCtx = {
  runId: string;
  projectId: string;
  profile: ResolvedProfile;
  payload: RunPayload;
  isCanceled: () => Promise<boolean>;
};

/** 单个单元的产出：用量、落库行数、非致命错误（如出处未定位）。 */
export type UnitOutcome = {
  usage: ChatUsage;
  produced: number;
  errors?: string[];
};

/** 预览描述：向用户展示「将发送什么」，不发起任何请求。 */
export type TaskDescriptor = {
  unitCount: number;
  unitLabel: string;
  totalChars: number;
  sampleText: string;
  note: string;
};

export type TaskDefinition = {
  type: string;
  label: string;
  scope: TaskScope;
  surface: TaskSurface;
  promptVersion: string;
  maxTokens: number;
  /** 校验输入，不合法抛 AnalysisError。 */
  validate(ctx: TaskSetupCtx): Promise<void>;
  /** 枚举待处理单元；返回空数组由运行器报错。 */
  listUnits(ctx: TaskSetupCtx): Promise<TaskUnit[]>;
  /** 处理单个单元并落库。 */
  runUnit(unit: TaskUnit, ctx: TaskRunCtx): Promise<UnitOutcome>;
  /** 预览「将发送什么」。 */
  describe(ctx: TaskSetupCtx): Promise<TaskDescriptor>;
};
