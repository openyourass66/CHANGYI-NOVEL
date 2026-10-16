import "server-only";
import { prisma } from "@/lib/db";
import { resolveProfile } from "@/lib/ai/client";
import { AnalysisError } from "@/lib/ai/errors";
import { getTask, getTaskOrNull } from "@/lib/ai/tasks/registry";
import type { ChatUsage } from "@/lib/ai/types";
import type { RunPayload, TaskUnit } from "@/lib/ai/tasks/types";

export { AnalysisError };

/** 每批处理的单元数。 */
const BATCH_SIZE = 4;

/** 进程内防重入：同一 run 不被并发处理两次。 */
const RUNNING = new Set<string>();

/** 判定 running 任务失联的静默时长：远超一批的处理时间，避免误报活跃任务。 */
const STALL_AFTER_MS = 90_000;

/**
 * 是否有处理器正在跑这个 run。进程重启后 RUNNING 为空，故 running 且不在其中即为僵尸任务——
 * 这里只做视图判定，不改 DB 状态，交由 /resume 重新接管。
 */
export function isProcessing(runId: string): boolean {
  return RUNNING.has(runId);
}

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

type StoredInput = { payload: RunPayload; units: TaskUnit[] };

export type StartOptions = {
  taskType: string;
  profileId: string;
  authorized?: boolean;
  payload?: RunPayload;
  /** 兼容旧调用：等价于 payload.chapterIds。 */
  chapterIds?: string[];
};

function sumUsage(a: ChatUsage, b: ChatUsage): ChatUsage {
  return {
    promptTokens: (a.promptTokens ?? 0) + (b.promptTokens ?? 0),
    completionTokens: (a.completionTokens ?? 0) + (b.completionTokens ?? 0),
    totalTokens: (a.totalTokens ?? 0) + (b.totalTokens ?? 0),
  };
}

function seedProgress(unitsTotal: number): Progress {
  return {
    batchIndex: 0,
    batchTotal: Math.ceil(unitsTotal / BATCH_SIZE),
    unitsDone: 0,
    unitsTotal,
    produced: 0,
    errors: [],
    doneIds: [],
    failedIds: [],
    currentUnitId: null,
    currentLabel: null,
  };
}

function normalizePayload(opts: StartOptions): RunPayload {
  const base = opts.payload ?? {};
  if (!base.chapterIds && opts.chapterIds && opts.chapterIds.length > 0) {
    return { ...base, chapterIds: opts.chapterIds };
  }
  return base;
}

/** 解析 inputRangeJson。新格式为 {payload, units}；旧格式 {chapterIds} 兼容合成单元。 */
function parseStoredInput(json: string): StoredInput {
  let raw: { payload?: RunPayload; units?: TaskUnit[]; chapterIds?: string[] } = {};
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    raw = {};
  }
  if (Array.isArray(raw.units)) {
    return { payload: raw.payload ?? {}, units: raw.units };
  }
  const ids = Array.isArray(raw.chapterIds) ? raw.chapterIds : [];
  return {
    payload: { chapterIds: ids },
    units: ids.map((id) => ({ id, label: id, chapterId: id })),
  };
}

async function saveProgress(runId: string, progress: Progress): Promise<void> {
  await prisma.analysisRun.update({
    where: { id: runId },
    data: { progressJson: JSON.stringify(progress) },
  });
}

async function setChapterStatus(chapterId: string, status: string): Promise<void> {
  await prisma.chapter
    .update({ where: { id: chapterId }, data: { analysisStatus: status } })
    .catch(() => undefined);
}

/**
 * 创建并启动一次分析任务。远端档案必须显式授权（authorized===true），
 * 否则拒绝——保证原文/记忆不外发的最终关口在服务端。
 */
export async function startAnalysisRun(
  projectId: string,
  opts: StartOptions,
): Promise<string> {
  const task = getTask(opts.taskType);

  const project = await prisma.novelProject.findUnique({ where: { id: projectId } });
  if (!project) throw new AnalysisError("项目不存在。", 404);

  const profile = await resolveProfile(opts.profileId);
  if (!profile.isLocal && opts.authorized !== true) {
    throw new AnalysisError("远端模型需要用户授权后才能发送原文。", 403);
  }

  const payload = normalizePayload(opts);
  const setupCtx = { projectId, payload };
  await task.validate(setupCtx);

  const units = await task.listUnits(setupCtx);
  if (units.length === 0) {
    throw new AnalysisError(task.scope === "chapter" ? "没有可分析的章节。" : "没有可处理的单元。");
  }

  const progress = seedProgress(units.length);
  const stored: StoredInput = { payload, units };

  const run = await prisma.analysisRun.create({
    data: {
      projectId,
      taskType: task.type,
      modelProfileId: profile.id,
      promptVersion: task.promptVersion,
      status: "pending",
      inputRangeJson: JSON.stringify(stored),
      progressJson: JSON.stringify(progress),
      authorizedAt: profile.isLocal ? null : new Date(),
    },
  });

  // 不 await：响应返回后继续在服务端处理，前端轮询进度。
  void processRun(run.id).catch(() => undefined);
  return run.id;
}

export async function processRun(runId: string): Promise<void> {
  if (RUNNING.has(runId)) return;
  RUNNING.add(runId);
  try {
    const run = await prisma.analysisRun.findUnique({ where: { id: runId } });
    if (!run) return;
    if (run.status === "canceled") return;

    const task = getTaskOrNull(run.taskType);
    if (!task) {
      await prisma.analysisRun.update({
        where: { id: runId },
        data: { status: "failed", error: "未知任务类型。" },
      });
      return;
    }

    const profile = run.modelProfileId ? await resolveProfile(run.modelProfileId) : null;
    if (!profile) {
      await prisma.analysisRun.update({
        where: { id: runId },
        data: { status: "failed", error: "模型档案不存在。" },
      });
      return;
    }

    const stored = parseStoredInput(run.inputRangeJson);
    const progress: Progress = {
      ...seedProgress(stored.units.length),
      ...(JSON.parse(run.progressJson || "{}") as Partial<Progress>),
    };
    if (!Array.isArray(progress.failedIds)) progress.failedIds = [];

    // 以存下的单元为准，与当前有效单元取交集（容忍章节被删除）；交集为空则保留原单元。
    let units = stored.units;
    try {
      const live = await task.listUnits({ projectId: run.projectId, payload: stored.payload });
      const liveIds = new Set(live.map((u) => u.id));
      const intersected = stored.units.filter((u) => liveIds.has(u.id));
      if (intersected.length > 0) units = intersected;
      else if (live.length > 0) units = live;
    } catch {
      // 重新枚举失败（如依赖已被删除）：沿用存下的单元。
    }
    progress.batchTotal = Math.ceil(units.length / BATCH_SIZE) || 1;
    progress.unitsTotal = units.length;

    await prisma.analysisRun.update({
      where: { id: runId },
      data: { status: "running", startedAt: run.startedAt ?? new Date(), error: null },
    });

    const isCanceled = async () => {
      const current = await prisma.analysisRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      return current?.status === "canceled";
    };

    let usageTotal: ChatUsage = JSON.parse(run.usageJson || "{}") as ChatUsage;

    for (let b = 0; b < progress.batchTotal; b++) {
      const slice = units.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
      progress.batchIndex = b + 1;
      await saveProgress(runId, progress);

      for (const unit of slice) {
        if (await isCanceled()) {
          await prisma.analysisRun.update({
            where: { id: runId },
            data: { progressJson: JSON.stringify(progress), finishedAt: new Date() },
          });
          return;
        }
        // 仅跳过「本次任务」已处理的单元（中断后 resume 去重）；新任务重跑不受影响。
        if (progress.doneIds.includes(unit.id)) continue;

        if (unit.chapterId) await setChapterStatus(unit.chapterId, "analyzing");

        // 记录「正在处理」的单元，前端据此显示具体进度，而不是只盯着不动的进度条。
        progress.currentUnitId = unit.id;
        progress.currentLabel = unit.label;
        await saveProgress(runId, progress);

        try {
          const out = await task.runUnit(unit, {
            runId,
            projectId: run.projectId,
            profile,
            payload: stored.payload,
            isCanceled,
          });
          usageTotal = sumUsage(usageTotal, out.usage);
          progress.produced += out.produced;
          if (out.errors && out.errors.length > 0) progress.errors.push(...out.errors);
          if (unit.chapterId) await setChapterStatus(unit.chapterId, "done");
        } catch (error) {
          const message = error instanceof Error ? error.message : "未知错误";
          const label = unit.chapterId ? `《${unit.label}》` : unit.label;
          progress.errors.push(`${label}：${message}`);
          progress.failedIds.push(unit.id);
          if (unit.chapterId) await setChapterStatus(unit.chapterId, "failed");
        }
        progress.currentUnitId = null;
        progress.currentLabel = null;
        progress.doneIds.push(unit.id);
        progress.unitsDone = progress.doneIds.length;
        await saveProgress(runId, progress);
      }
    }

    const hasFailedUnits = progress.failedIds.length > 0;
    await prisma.analysisRun.update({
      where: { id: runId },
      data: {
        status: hasFailedUnits ? "failed" : "done",
        finishedAt: new Date(),
        progressJson: JSON.stringify(progress),
        usageJson: JSON.stringify(usageTotal),
        error: progress.errors.length > 0 ? progress.errors.slice(0, 8).join("\n") : null,
      },
    });
  } catch (error) {
    await prisma.analysisRun
      .update({
        where: { id: runId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          error: error instanceof Error ? error.message : "未知错误",
        },
      })
      .catch(() => undefined);
  } finally {
    RUNNING.delete(runId);
  }
}

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

export async function getRunProgress(runId: string): Promise<RunStatusView | null> {
  const run = await prisma.analysisRun.findUnique({ where: { id: runId } });
  if (!run) return null;

  const stored = parseStoredInput(run.inputRangeJson);
  const task = getTaskOrNull(run.taskType);

  const chapterIds = stored.units
    .map((u) => u.chapterId)
    .filter((id): id is string => Boolean(id));
  const chapterRows =
    chapterIds.length > 0
      ? await prisma.chapter.findMany({
          where: { id: { in: chapterIds } },
          select: { id: true, rawTitle: true, analysisStatus: true },
        })
      : [];
  const chapterById = new Map(chapterRows.map((r) => [r.id, r]));

  const raw = JSON.parse(run.progressJson || "{}") as Partial<Progress> & {
    chaptersDone?: number;
    chaptersTotal?: number;
    proposals?: number;
  };
  const progress: Progress & Record<string, unknown> = {
    ...seedProgress(stored.units.length),
    ...raw,
  };
  // 兼容 Stage 0 之前的旧行：字段已由 chaptersDone/chaptersTotal/proposals 更名。
  if (!Array.isArray(progress.doneIds)) progress.doneIds = [];
  if (!Array.isArray(progress.failedIds)) progress.failedIds = [];
  progress.unitsDone = progress.doneIds.length;
  if (typeof raw.proposals === "number" && typeof raw.produced !== "number") {
    progress.produced = raw.proposals;
  }
  delete progress.chaptersDone;
  delete progress.chaptersTotal;
  delete progress.proposals;

  const doneSet = new Set(progress.doneIds);
  const failedSet = new Set(progress.failedIds);

  // 视图层面的「已中断」：DB 仍是 running（便于 /resume 接管），但已无处理器且久未更新进度。
  const stalled =
    run.status === "running" &&
    !isProcessing(run.id) &&
    Date.now() - run.updatedAt.getTime() > STALL_AFTER_MS;

  // 仅当运行确实在推进时才暴露「当前单元」，避免中断/完成后残留的当前单元被误读为进行中。
  const live = run.status === "running" && !stalled;
  if (!live) {
    progress.currentUnitId = null;
    progress.currentLabel = null;
  }

  const units: RunUnitView[] = stored.units.map((u, i) => {
    const chapter = u.chapterId ? chapterById.get(u.chapterId) : undefined;
    const status =
      live && u.id === progress.currentUnitId
        ? "analyzing"
        : u.chapterId
          ? (chapter?.analysisStatus ?? "pending")
          : doneSet.has(u.id)
            ? "done"
            : failedSet.has(u.id)
              ? "failed"
              : "pending";
    return {
      id: u.id,
      index: i + 1,
      label: chapter?.rawTitle ?? u.label,
      chapterId: u.chapterId ?? null,
      status,
    };
  });

  return {
    id: run.id,
    projectId: run.projectId,
    taskType: run.taskType,
    taskLabel: task?.label ?? run.taskType,
    unitLabel: task?.scope === "chapter" ? "章" : "项",
    status: stalled ? "stalled" : run.status,
    progress,
    usage: JSON.parse(run.usageJson || "{}") as ChatUsage,
    error: run.error,
    promptVersion: run.promptVersion,
    authorizedAt: run.authorizedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    payload: stored.payload,
    units,
  };
}

/** 重新接管一个 status=running 但无处理器在跑的任务（进程重启后的僵尸任务）。 */
export async function resumeRun(runId: string): Promise<RunStatusView | null> {
  const run = await prisma.analysisRun.findUnique({ where: { id: runId } });
  if (!run) throw new AnalysisError("任务不存在。", 404);
  if (run.status === "done" || run.status === "canceled") return getRunProgress(runId);
  let progressJson = run.progressJson;
  if (run.status === "failed") {
    const stored = parseStoredInput(run.inputRangeJson);
    const progress: Progress = {
      ...seedProgress(stored.units.length),
      ...(JSON.parse(run.progressJson || "{}") as Partial<Progress>),
    };
    const failedIds = Array.isArray(progress.failedIds) && progress.failedIds.length > 0
      ? progress.failedIds
      : progress.produced === 0 ? stored.units.map((unit) => unit.id) : [];
    if (failedIds.length === 0 && progress.doneIds.length >= stored.units.length) {
      throw new AnalysisError("旧任务无法安全地只重试失败单元，请重新发起该任务。");
    }
    const retryIds = new Set(failedIds);
    progress.doneIds = progress.doneIds.filter((id) => !retryIds.has(id));
    progress.unitsDone = progress.doneIds.length;
    progress.failedIds = [];
    progress.errors = [];
    progress.currentUnitId = null;
    progress.currentLabel = null;
    progressJson = JSON.stringify(progress);
  }
  await prisma.analysisRun.update({
    where: { id: runId },
    data: { status: "running", canceledAt: null, error: null, progressJson },
  });
  void processRun(runId).catch(() => undefined);
  return getRunProgress(runId);
}

export async function cancelRun(runId: string): Promise<RunStatusView | null> {
  const run = await prisma.analysisRun.findUnique({ where: { id: runId } });
  if (!run) throw new AnalysisError("任务不存在。", 404);
  await prisma.analysisRun.update({
    where: { id: runId },
    data: { status: "canceled", canceledAt: new Date(), finishedAt: new Date() },
  });
  return getRunProgress(runId);
}

/** 项目最近一次运行，供分析页/续写页恢复视图。可按任务类型过滤到某个入口。 */
export async function latestRun(
  projectId: string,
  taskTypes?: string[],
): Promise<RunStatusView | null> {
  const run = await prisma.analysisRun.findFirst({
    where: {
      projectId,
      ...(taskTypes && taskTypes.length > 0 ? { taskType: { in: taskTypes } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return run ? getRunProgress(run.id) : null;
}

/**
 * 每个任务类型最近一次运行，供步骤轨展示各步骤自身状态（而不是只有被选中的那一步）。
 * 未运行过的类型返回 null。
 */
export async function latestRunsByType(
  projectId: string,
  taskTypes: string[],
): Promise<Record<string, RunStatusView | null>> {
  const result: Record<string, RunStatusView | null> = {};
  for (const type of taskTypes) result[type] = null;
  if (taskTypes.length === 0) return result;

  const rows = await prisma.analysisRun.findMany({
    where: { projectId, taskType: { in: taskTypes } },
    orderBy: { createdAt: "desc" },
    select: { id: true, taskType: true },
  });

  const latestByType = new Map<string, string>();
  for (const row of rows) {
    if (!latestByType.has(row.taskType)) latestByType.set(row.taskType, row.id);
  }
  await Promise.all(
    [...latestByType].map(async ([type, id]) => {
      result[type] = await getRunProgress(id);
    }),
  );
  return result;
}
