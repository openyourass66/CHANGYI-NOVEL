"use client";
import { apiFetch } from "@/lib/client-api";


import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "@/components/operation-prompt";
import type { RunPreview } from "@contracts/api";
import type { RunStatusView } from "@contracts/api";
import type { RunPayload } from "@contracts/api";

export type StartRunArgs = {
  taskType: string;
  profileId: string;
  /** 逐章任务的章节范围；缺省＝全部。整项目任务留空。 */
  chapterIds?: string[];
  payload?: RunPayload;
};

/**
 * 分析任务的「预览 → 授权 → 启动 → 轮询」流程。理解分析页与续写规划页共用。
 * 云端档案先弹授权对话框，本地档案直接启动。
 */
export function useAnalysisRun(options: {
  projectId: string;
  initialRun?: RunStatusView | null;
  /** 运行到达终态时回调（用于刷新提案、回写该步骤的最近运行等）。 */
  onSettled?: (run: RunStatusView) => void;
}) {
  const { projectId, initialRun = null, onSettled } = options;

  const [runId, setRunId] = useState<string | null>(initialRun?.id ?? null);
  const [run, setRun] = useState<RunStatusView | null>(initialRun);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);

  const pendingArgs = useRef<StartRunArgs | null>(null);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const runActive = run?.status === "running" || run?.status === "pending";

  useEffect(() => {
    if (!runId || !runActive) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await apiFetch(`/api/analysis/${runId}`, { cache: "no-store" });
        if (!active) return;
        const data = (await res.json()) as { run?: RunStatusView };
        if (data.run) {
          setRun(data.run);
          const terminal = data.run.status !== "running" && data.run.status !== "pending";
          if (terminal) settledRef.current?.(data.run);
        }
      } catch {
        // 轮询失败：保留上一次状态，下次继续
      }
    };
    void tick();
    const timer = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [runId, runActive]);

  const launch = useCallback(
    async (args: StartRunArgs, authorized: boolean) => {
      const res = await apiFetch(`/api/projects/${projectId}/analysis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterIds: args.chapterIds,
          taskType: args.taskType,
          profileId: args.profileId,
          payload: args.payload,
          authorized,
          deviceId: window.changyi ? (await window.changyi.configuration()).deviceId : undefined,
        }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) throw new Error(data.error ?? "启动失败");
      setAuthOpen(false);
      setPreview(null);
      setRunId(data.runId);
      setRun(null);
      notify.success("任务已开始");
    },
    [projectId],
  );

  const start = useCallback(
    async (args: StartRunArgs) => {
      if (!args.profileId) {
        notify.error("请先在设置中新增模型档案。");
        return;
      }
      pendingArgs.current = args;
      setBusy(true);
      try {
        const res = await apiFetch(`/api/projects/${projectId}/analysis/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapterIds: args.chapterIds,
            taskType: args.taskType,
            profileId: args.profileId,
            payload: args.payload,
          }),
        });
        const data = (await res.json()) as { preview?: RunPreview; error?: string };
        if (!res.ok || !data.preview) throw new Error(data.error ?? "预览失败");
        if (!data.preview.isLocal) {
          setPreview(data.preview);
          setAuthOpen(true);
          return;
        }
        if (window.changyi && !(await window.changyi.localProfile(args.profileId))) throw new Error("请先在当前设备的设置中保存并测试该本地模型档案。");
        await launch(args, false);
      } catch (error) {
        notify.error(error instanceof Error ? error.message : "启动失败");
      } finally {
        setBusy(false);
      }
    },
    [projectId, launch],
  );

  const confirmAuthorize = useCallback(async () => {
    const args = pendingArgs.current;
    if (!args) return;
    setAuthorizing(true);
    try {
      await launch(args, true);
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "启动失败");
    } finally {
      setAuthorizing(false);
    }
  }, [launch]);

  const runAction = useCallback(
    async (action: "cancel" | "resume") => {
      if (!runId) return;
      setBusy(true);
      try {
        const res = await apiFetch(`/api/analysis/${runId}/${action}`, { method: "POST" });
        const data = (await res.json()) as { run?: RunStatusView; error?: string };
        if (!res.ok) throw new Error(data.error ?? "操作失败");
        if (data.run) setRun(data.run);
        notify.success(action === "cancel" ? "已请求取消" : "已重新开始处理");
      } catch (error) {
        notify.error(error instanceof Error ? error.message : "操作失败");
      } finally {
        setBusy(false);
      }
    },
    [runId],
  );

  return {
    runId,
    run,
    runActive,
    busy,
    preview,
    authOpen,
    setAuthOpen: (open: boolean) => {
      if (!authorizing) setAuthOpen(open);
    },
    authorizing,
    start,
    confirmAuthorize,
    cancel: () => runAction("cancel"),
    resume: () => runAction("resume"),
  };
}
