"use client";

import { useCallback, useMemo, useState } from "react";
import { notify } from "@/components/operation-prompt";
import {
  AlertTriangle,
  Check,
  Cpu,
  Loader2,
  Play,
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MEMORY_CATEGORY,
  MEMORY_STATUS,
  MEMORY_STATUS_TONE,
  toneClass,
  type Tone,
} from "@/lib/domain";
import type { ProfileView } from "@/lib/ai/profiles";
import type { RunStatusView } from "@/lib/ai/runner";
import type { TaskSummary } from "@/lib/ai/tasks/registry";
import type { ProposalKind, ProposalState, ProposalView } from "@/lib/ai/types";
import { REQUIREMENT_HINT, requirementMet } from "@/lib/ai/requirements";
import { stageStatusOf, stageMetaOf } from "@/lib/ai/progress-view";
import { TaskWorkspace } from "./task-workspace";
import { CloudAuthorizeDialog } from "@/components/projects/cloud-authorize-dialog";
import { type Stage } from "@/components/projects/stage-rail";
import { RunStatusPanel } from "@/components/projects/run-status";
import { useAnalysisRun } from "@/components/projects/use-analysis-run";

type ChapterOption = { id: string; index: number; title: string; charCount: number };

const PROPOSAL_KIND_LABEL: Record<ProposalKind, string> = {
  add: "新增",
  update: "更新",
  conflict: "冲突",
};
const PROPOSAL_KIND_TONE: Record<ProposalKind, Tone> = {
  add: "success",
  update: "info",
  conflict: "warning",
};

const PROPOSAL_STATE_LABEL: Record<ProposalState, string> = {
  pending: "待审阅",
  accepted: "已采纳",
  rejected: "已忽略",
  conflicted: "冲突待裁决",
};

const STATE_TABS: ProposalState[] = ["pending", "accepted", "rejected", "conflicted"];

export function AnalysisPanel({
  projectId,
  projectName,
  chapters,
  profiles,
  tasks,
  initialProposals,
  initialCounts,
  initialRun,
  taskRuns: initialTaskRuns,
  totalMemory,
  hasMemory,
  initialStage,
}: {
  projectId: string;
  projectName: string;
  chapters: ChapterOption[];
  profiles: ProfileView[];
  tasks: TaskSummary[];
  initialProposals: ProposalView[];
  initialCounts: Record<string, number>;
  initialRun: RunStatusView | null;
  /** 每个任务最近的运行，供步骤轨显示各步骤状态。 */
  taskRuns: Record<string, RunStatusView | null>;
  totalMemory: number;
  hasMemory: boolean;
  /** 恢复视图时要选中的步骤（最近一次运行的任务类型）。 */
  initialStage: string | null;
}) {
  const [profileId, setProfileId] = useState(
    () => profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "",
  );
  const [taskType, setTaskType] = useState(
    () => initialStage ?? tasks[0]?.type ?? "chapter-extract",
  );
  const [mode, setMode] = useState<"all" | "range">("all");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(chapters.map((c) => c.id)),
  );
  const [taskRuns, setTaskRuns] = useState(initialTaskRuns);
  const [actionBusy, setActionBusy] = useState(false);

  const [proposals, setProposals] = useState(initialProposals);
  const [counts, setCounts] = useState(initialCounts);
  const [stateTab, setStateTab] = useState<ProposalState>("pending");
  const [acting, setActing] = useState<string | null>(null);

  const activeTask = tasks.find((t) => t.type === taskType) ?? tasks[0];
  const isChapterScope = activeTask?.scope === "chapter";

  const refreshProposals = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/proposals`, { cache: "no-store" });
      const data = (await res.json()) as {
        proposals?: ProposalView[];
        counts?: Record<string, number>;
      };
      if (data.proposals) setProposals(data.proposals);
      if (data.counts) setCounts(data.counts);
    } catch {
      // 刷新失败不打断主流程
    }
  }, [projectId]);

  const {
    run: hookRun,
    runActive,
    busy: runBusy,
    preview,
    authOpen,
    setAuthOpen,
    authorizing,
    start: startRun,
    confirmAuthorize,
    cancel,
    resume,
  } = useAnalysisRun({
    projectId,
    initialRun,
    onSettled: (settled) => {
      void refreshProposals();
      setTaskRuns((prev) => ({ ...prev, [settled.taskType]: settled }));
    },
  });

  const busy = runBusy || actionBusy;

  /** 某一步骤要展示的运行：进行中的那次优先，否则用该步骤的服务端最近一次。 */
  function runForStage(key: string): RunStatusView | null {
    if (hookRun && hookRun.taskType === key) return hookRun;
    return taskRuns[key] ?? null;
  }

  const requirementState = {
    hasMemory,
    planCount: 0,
    outlineCount: 0,
    draftCount: 0,
  };

  const stages: Stage[] = tasks.map((t) => {
    const stageRun = runForStage(t.type);
    const met = requirementMet(t.requirement, requirementState);
    return {
      key: t.type,
      label: t.label,
      description: t.description,
      status: stageStatusOf(stageRun),
      meta:
        stageMetaOf(stageRun) ??
        (t.requirement === "memory" ? `已有 ${totalMemory} 条记忆` : null),
      hint: met || !t.requirement ? null : REQUIREMENT_HINT[t.requirement],
    };
  });

  const activeStage = stages.find((s) => s.key === taskType);
  const displayRun = runForStage(taskType);
  // 只有被 hook 跟踪的那次运行才可取消/继续（服务端渲染的历史运行是只读的）。
  const runActions =
    hookRun && hookRun.taskType === taskType
      ? { busy, onCancel: () => void cancel(), onResume: () => void resume() }
      : null;

  const selectedChapters = useMemo(
    () => chapters.filter((c) => selected.has(c.id)),
    [chapters, selected],
  );
  const selectedChars = selectedChapters.reduce((sum, c) => sum + c.charCount, 0);

  function toggleChapter(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** 逐章任务才带章节范围；整项目任务返回 undefined。 */
  function scopeIds(): string[] | undefined {
    if (!isChapterScope) return undefined;
    if (mode === "all") return undefined;
    return chapters.filter((c) => selected.has(c.id)).map((c) => c.id);
  }

  async function start() {
    const ids = scopeIds();
    if (isChapterScope && mode === "range" && (!ids || ids.length === 0)) {
      notify.error("请选择至少一个章节。");
      return;
    }
    await startRun({ taskType, profileId, chapterIds: ids });
  }

  async function act(id: string, action: "accept" | "reject") {
    setActing(id);
    try {
      const res = await fetch(`/api/proposals/${id}/${action}`, { method: "POST" });
      const data = (await res.json()) as {
        proposal?: ProposalView;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "操作失败");
      if (data.message) notify.warning(data.message);
      else notify.success(action === "accept" ? "已采纳" : "已忽略");
      await refreshProposals();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setActing(null);
    }
  }

  async function acceptAll() {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/proposals/accept-all`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        accepted?: number;
        conflicted?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "操作失败");
      notify.success(
        `已采纳 ${data.accepted ?? 0} 条${data.conflicted ? `，${data.conflicted} 条冲突待裁决` : ""}`,
      );
      await refreshProposals();
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setActionBusy(false);
    }
  }

  const filteredProposals = proposals.filter((p) => p.state === stateTab);
  const blocked = activeStage?.hint ?? null;

  return (
    <TaskWorkspace projectId={projectId} projectName={projectName} section="理解分析" description="理解分析 · 依据原文提炼记忆，审阅后融入故事。" stages={stages} taskType={taskType} onSelect={setTaskType} running={runActive} modelName={profiles.find((p) => p.id === profileId)?.name} configuration={
      <Card>
        <CardContent className="space-y-4 py-5">


          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{activeTask?.label}</span>
              <p className="text-xs text-muted-foreground">{activeTask?.description}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="an-profile">模型档案</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id="an-profile">
                  <SelectValue placeholder="选择模型档案" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.model}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {profiles.length === 0 && (
                <p className="text-xs text-destructive">暂无模型档案，请先到「设置」新增。</p>
              )}
            </div>
          </div>

          {isChapterScope && (
            <div className="space-y-1.5">
              <Label>分析范围</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={mode === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("all")}
                >
                  全部章节
                </Button>
                <Button
                  type="button"
                  variant={mode === "range" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setMode("range")}
                >
                  指定范围
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "all"
                  ? `共 ${chapters.length} 章，约 ${chapters.reduce((s, c) => s + c.charCount, 0)} 字`
                  : `已选 ${selectedChapters.length} 章，约 ${selectedChars} 字`}
              </p>
            </div>
          )}

          {isChapterScope && mode === "range" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">选择章节</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set(chapters.map((c) => c.id)))}
                  >
                    全选
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                  >
                    清空
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-56 rounded-md border">
                <ul className="divide-y">
                  {chapters.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        id={`ch-${c.id}`}
                        checked={selected.has(c.id)}
                        onCheckedChange={() => toggleChapter(c.id)}
                      />
                      <label
                        htmlFor={`ch-${c.id}`}
                        className="flex flex-1 cursor-pointer items-center justify-between gap-2 text-sm"
                      >
                        <span className="truncate">
                          第 {c.index} 章 · {c.title}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.charCount} 字
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          )}

          {blocked && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{blocked}（仍可启动，服务端会再次校验）。</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => void start()} disabled={busy || runActive || profiles.length === 0}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              开始{activeTask?.label ?? "分析"}
            </Button>
          </div>
        </CardContent>
      </Card>
      }>

      {/* 运行状态（常驻，即使没跑过也显示状态说明） */}
      <RunStatusPanel
        taskLabel={activeTask?.label ?? "分析"}
        run={displayRun}
        producedLabel="条提案"
        idleHint={
          blocked
            ? `这个步骤还没有运行过。${blocked}。`
            : "这个步骤还没有运行过，配置好后点上面的「开始」。"
        }
        actions={runActions}
      />

      {/* 提案审阅 */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">记忆提案</span>
              <span className="text-sm text-muted-foreground">
                共 {proposals.length} 条
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void refreshProposals()}>
                <RotateCcw className="size-4" />
                刷新
              </Button>
              <Button
                size="sm"
                onClick={() => void acceptAll()}
                disabled={busy || (counts.pending ?? 0) === 0}
              >
                <Check className="size-4" />
                全部采纳
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {STATE_TABS.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={stateTab === s ? "default" : "outline"}
                aria-pressed={stateTab === s}
                onClick={() => setStateTab(s)}
              >
                {PROPOSAL_STATE_LABEL[s]}
                <span className="ml-1 text-xs opacity-70">{counts[s] ?? 0}</span>
              </Button>
            ))}
          </div>

          {filteredProposals.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                {proposals.length === 0
                  ? "还没有提案。开始一次分析后，模型产出的记忆提案会出现在这里。"
                  : `没有「${PROPOSAL_STATE_LABEL[stateTab]}」的提案。`}
              </p>
            </div>
          ) : (
            <ul role="list" className="space-y-2">
              {filteredProposals.map((p) => (
                <li key={p.id} className="rounded-lg border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={toneClass(PROPOSAL_KIND_TONE[p.kind])}>
                      {PROPOSAL_KIND_LABEL[p.kind]}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {MEMORY_CATEGORY[p.category]}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={toneClass(MEMORY_STATUS_TONE[p.status] ?? "muted")}
                    >
                      {MEMORY_STATUS[p.status]}
                    </Badge>
                    <span className="font-medium">{p.title || p.key || "（无标题）"}</span>
                    {p.draftLabel && (
                      <Badge variant="outline" className="text-xs font-normal">
                        来自续写草稿 · {p.draftLabel}
                      </Badge>
                    )}
                  </div>

                  <p className="mt-2 line-clamp-4 text-sm whitespace-pre-wrap text-muted-foreground">
                    {p.content}
                  </p>

                  {p.citations.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {p.citations.map((c, i) => (
                        <Badge key={i} variant="outline" className="text-xs font-normal">
                          第 {c.chapterIndex} 章
                          {c.excerpt ? `：${c.excerpt.slice(0, 18)}…` : ""}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {p.state === "conflicted" && p.reason && (
                    <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                      <ShieldAlert className="size-3.5" aria-hidden />
                      {p.reason}（请到记忆工作台人工裁决）
                    </p>
                  )}

                  {p.state === "pending" && (
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void act(p.id, "reject")}
                        disabled={acting === p.id}
                      >
                        <X className="size-4" />
                        忽略
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void act(p.id, "accept")}
                        disabled={acting === p.id}
                      >
                        {acting === p.id ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Check className="size-4" />
                        )}
                        采纳
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CloudAuthorizeDialog
        open={authOpen}
        preview={preview}
        authorizing={authorizing}
        onOpenChange={setAuthOpen}
        onConfirm={() => void confirmAuthorize()}
      />

      {profiles.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Cpu className="size-3.5" aria-hidden />
          本地模型（Ollama / LM Studio）请求不会离开本机；云端模型需逐次授权。
        </p>
      )}
    </TaskWorkspace>
  );
}
