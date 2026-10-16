"use client";

import { useCallback, useEffect, useState } from "react";
import { notify } from "@/components/operation-prompt";
import {
  AlertTriangle,
  Check,
  Compass,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Save,
  ScanSearch,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MEMORY_UPDATE_LABEL, MEMORY_UPDATE_TONE, PLAN_STATUS_LABEL, PLAN_STATUS_TONE } from "@/lib/continuation-view";
import type {
  ContinuityIssueView,
  ContinuationPlanView,
  DraftChapterView,
  OutlineItem,
} from "@/lib/continuation-view";
import { cn } from "@/lib/utils";
import type { ProfileView } from "@/lib/ai/profiles";
import type { RunStatusView } from "@/lib/ai/runner";
import type { TaskSummary } from "@/lib/ai/tasks/registry";
import type { IssueStatus } from "@/lib/domain";
import { toneClass } from "@/lib/domain";
import { REQUIREMENT_HINT, requirementMet } from "@/lib/ai/requirements";
import { stageMetaOf, stageStatusOf } from "@/lib/ai/progress-view";
import { ProjectNav } from "@/components/projects/project-nav";
import { CloudAuthorizeDialog } from "@/components/projects/cloud-authorize-dialog";
import { DraftEditor } from "@/components/projects/draft-editor";
import { StageRail, type Stage } from "@/components/projects/stage-rail";
import { RunStatusPanel } from "@/components/projects/run-status";
import { useAnalysisRun } from "@/components/projects/use-analysis-run";

const OUTLINE_COUNT_OPTIONS = [3, 5, 8, 10];

/** 这些步骤的产物是草稿，选中时展开草稿卡片（否则保持紧凑）。 */
const DRAFT_STAGES = new Set(["draft", "continuity-check", "draft-memory"]);

/** 「已产出」的量词，按步骤给。 */
const PRODUCED_LABEL: Record<string, string> = {
  direction: "个方向",
  outline: "章",
  draft: "章",
  "continuity-check": "处问题",
  "draft-memory": "条提案",
};

type Editing = { planId: string; items: OutlineItem[] };

export function ContinuationPanel({
  projectId,
  projectName,
  profiles,
  tasks,
  initialPlans,
  initialRun = null,
  taskRuns: initialTaskRuns,
  hasMemory,
  initialStage,
}: {
  projectId: string;
  projectName: string;
  profiles: ProfileView[];
  tasks: TaskSummary[];
  initialPlans: ContinuationPlanView[];
  initialRun?: RunStatusView | null;
  taskRuns: Record<string, RunStatusView | null>;
  hasMemory: boolean;
  initialStage: string | null;
}) {
  const [profileId, setProfileId] = useState(
    () => profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "",
  );
  const [taskType, setTaskType] = useState(() => initialStage ?? tasks[0]?.type ?? "direction");
  const [outlineCount, setOutlineCount] = useState(5);
  const [taskRuns, setTaskRuns] = useState(initialTaskRuns);

  const [plans, setPlans] = useState(initialPlans);
  const [expandedId, setExpandedId] = useState<string | null>(
    () =>
      initialPlans.find((p) => p.status === "active")?.id ?? initialPlans[0]?.id ?? null,
  );
  const [editing, setEditing] = useState<Editing | null>(null);
  const [actingPlan, setActingPlan] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ContinuationPlanView | null>(null);

  const [drafts, setDrafts] = useState<DraftChapterView[]>([]);
  const [issues, setIssues] = useState<ContinuityIssueView[]>([]);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const activeTask = tasks.find((t) => t.type === taskType) ?? tasks[0];
  const needsPlan = Boolean(activeTask?.requirement) && activeTask?.requirement !== "memory";
  const showOutlineCount = activeTask?.type === "outline";
  const isContinuityTask = activeTask?.type === "continuity-check";
  const isDraftMemoryTask = activeTask?.type === "draft-memory";
  const showDrafts = DRAFT_STAGES.has(taskType);

  const targetPlan = plans.find((p) => p.id === expandedId) ?? null;
  const targetPlanId = targetPlan?.id ?? null;
  const editingDraft = drafts.find((d) => d.id === editingDraftId) ?? null;

  /** 未决问题数（按草稿分组），用于草稿列表徽标。 */
  const openIssueCounts = (() => {
    const map = new Map<string, number>();
    for (const issue of issues) {
      if (issue.status === "open" && issue.draftId) {
        map.set(issue.draftId, (map.get(issue.draftId) ?? 0) + 1);
      }
    }
    return map;
  })();
  const editingDraftIssues = editingDraft
    ? issues.filter((i) => i.draftId === editingDraft.id)
    : [];

  const refreshPlans = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/plans`, { cache: "no-store" });
      const data = (await res.json()) as { plans?: ContinuationPlanView[] };
      if (data.plans) setPlans(data.plans);
    } catch {
      // 刷新失败不打断主流程
    }
  }, [projectId]);

  const {
    run: hookRun,
    runActive,
    busy,
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
      void refreshPlans();
      setTaskRuns((prev) => ({ ...prev, [settled.taskType]: settled }));
      setReloadKey((k) => k + 1);
    },
  });

  // 需要看草稿的步骤：拉取所选方向的草稿。
  useEffect(() => {
    if (!showDrafts || !targetPlanId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/plans/${targetPlanId}/drafts`, {
          cache: "no-store",
        });
        const data = (await res.json()) as { drafts?: DraftChapterView[] };
        if (active && data.drafts) setDrafts(data.drafts);
      } catch {
        // 刷新失败不打断主流程
      }
    })();
    return () => {
      active = false;
    };
  }, [showDrafts, targetPlanId, reloadKey, projectId]);

  // 顺带拉一次本项目的连续性检查问题，供列表徽标与编辑器共用。
  useEffect(() => {
    if (!showDrafts) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/issues`, { cache: "no-store" });
        const data = (await res.json()) as { issues?: ContinuityIssueView[] };
        if (active && data.issues) setIssues(data.issues);
      } catch {
        // 刷新失败不打断主流程
      }
    })();
    return () => {
      active = false;
    };
  }, [showDrafts, reloadKey, projectId]);

  /** 某一步骤要展示的运行：进行中的那次优先，否则用该步骤的服务端最近一次。 */
  function runForStage(key: string): RunStatusView | null {
    if (hookRun && hookRun.taskType === key) return hookRun;
    return taskRuns[key] ?? null;
  }

  const requirementState = {
    hasMemory,
    planCount: plans.length,
    outlineCount: targetPlan?.outline.length ?? 0,
    draftCount: targetPlan?.draftCount ?? 0,
  };

  const stages: Stage[] = tasks.map((t) => {
    const stageRun = runForStage(t.type);
    const met = requirementMet(t.requirement, requirementState);
    const fallbackMeta =
      t.requirement === "plan"
        ? `共 ${plans.length} 个方向`
        : t.requirement === "outline"
          ? `当前方向 ${targetPlan?.outline.length ?? 0} 章纲`
          : t.requirement === "drafts"
            ? `当前方向 ${targetPlan?.draftCount ?? 0} 章草稿`
            : null;
    return {
      key: t.type,
      label: t.label,
      description: t.description,
      status: stageStatusOf(stageRun),
      meta: stageMetaOf(stageRun) ?? fallbackMeta,
      hint: met || !t.requirement ? null : REQUIREMENT_HINT[t.requirement],
    };
  });

  const activeStage = stages.find((s) => s.key === taskType);
  const displayRun = runForStage(taskType);
  const runActions =
    hookRun && hookRun.taskType === taskType
      ? { busy, onCancel: () => void cancel(), onResume: () => void resume() }
      : null;

  async function start() {
    if (needsPlan && !targetPlan) {
      notify.error("请先生成一个续写方向。");
      return;
    }
    await startRun({
      taskType,
      profileId,
      payload: needsPlan
        ? { planId: targetPlan!.id, ...(showOutlineCount ? { outlineCount } : {}) }
        : undefined,
    });
  }

  async function regenerateDraft(draft: DraftChapterView) {
    if (!targetPlanId) return;
    await startRun({
      taskType: "draft",
      profileId,
      payload: { planId: targetPlanId, outlineIndex: draft.index },
    });
  }

  /** 检查连续性：指定草稿时只查该章，否则检查所选方向的全部草稿。 */
  async function checkContinuity(draft?: DraftChapterView) {
    const planId = draft?.planId ?? targetPlanId;
    if (!planId) {
      notify.error("请先选定一个续写方向。");
      return;
    }
    await startRun({
      taskType: "continuity-check",
      profileId,
      payload: { planId, ...(draft ? { draftId: draft.id } : {}) },
    });
  }

  /** 提取记忆变化：指定草稿时只处理该章，否则处理所选方向的全部草稿。 */
  async function proposeMemory(draft?: DraftChapterView) {
    const planId = draft?.planId ?? targetPlanId;
    if (!planId) {
      notify.error("请先选定一个续写方向。");
      return;
    }
    await startRun({
      taskType: "draft-memory",
      profileId,
      payload: { planId, ...(draft ? { draftId: draft.id } : {}) },
    });
  }

  async function setIssueStatus(issueId: string, status: IssueStatus) {
    const prev = issues;
    setIssues((list) => list.map((i) => (i.id === issueId ? { ...i, status } : i)));
    try {
      const res = await fetch(`/api/projects/${projectId}/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json()) as { issue?: ContinuityIssueView; error?: string };
      if (!res.ok || !data.issue) throw new Error(data.error ?? "更新失败");
      setIssues((list) => list.map((i) => (i.id === issueId ? data.issue! : i)));
    } catch (error) {
      setIssues(prev);
      notify.error(error instanceof Error ? error.message : "更新失败");
    }
  }

  async function activate(id: string) {
    setActingPlan(id);
    try {
      const res = await fetch(`/api/projects/${projectId}/plans/${id}/activate`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "选定失败");
      await refreshPlans();
      notify.success("已选为当前续写方向");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "选定失败");
    } finally {
      setActingPlan(null);
    }
  }

  async function removePlan(plan: ContinuationPlanView) {
    setPendingDelete(null);
    setActingPlan(plan.id);
    try {
      const res = await fetch(`/api/projects/${projectId}/plans/${plan.id}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "删除失败");
      if (editing?.planId === plan.id) setEditing(null);
      await refreshPlans();
      notify.success("已删除该方向");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "删除失败");
    } finally {
      setActingPlan(null);
    }
  }

  function beginEdit(plan: ContinuationPlanView) {
    setExpandedId(plan.id);
    setEditing({
      planId: plan.id,
      items: plan.outline.map((item) => ({ ...item, beats: [...item.beats] })),
    });
  }

  function updateItem(index: number, patch: Partial<OutlineItem>) {
    setEditing((prev) =>
      prev
        ? { ...prev, items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) }
        : prev,
    );
  }

  function addItem() {
    setEditing((prev) =>
      prev
        ? {
            ...prev,
            items: [
              ...prev.items,
              {
                index: prev.items.length + 1,
                title: "",
                summary: "",
                beats: [],
                relatedThreads: [],
              },
            ],
          }
        : prev,
    );
  }

  function removeItem(index: number) {
    setEditing((prev) =>
      prev ? { ...prev, items: prev.items.filter((_, i) => i !== index) } : prev,
    );
  }

  async function saveOutline() {
    if (!editing) return;
    const items = editing.items.map((it) => ({ ...it, title: it.title.trim() }));
    if (items.some((it) => !it.title)) {
      notify.error("每一章都要有标题。");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/plans/${editing.planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline: items }),
      });
      const data = (await res.json()) as { plan?: ContinuationPlanView; error?: string };
      if (!res.ok || !data.plan) throw new Error(data.error ?? "保存失败");
      const saved = data.plan;
      setPlans((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
      setEditing(null);
      notify.success("章纲已保存");
    } catch (error) {
      notify.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const blocked =
    showOutlineCount && targetPlan && targetPlan.draftCount > 0
      ? `当前方向已有 ${targetPlan.draftCount} 章草稿。为避免旧草稿错配新章纲，请先导出需要保留的草稿并删除该方向的现有草稿。`
      : activeStage?.hint ?? null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6 lg:px-6">
      <ProjectNav projectId={projectId} />
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{projectName}</h1>
        <p className="text-sm text-muted-foreground">
          在已有记忆之上按步骤续写：生成方向 → 排章纲 → 写草稿 → 核对并提取记忆变化。
        </p>
      </header>

      {/* 步骤轨 + 当前步骤配置 */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <StageRail
            stages={stages}
            activeKey={taskType}
            onSelect={setTaskType}
            disabled={runActive}
          />

          <Separator />

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <span className="text-sm font-medium">{activeTask?.label}</span>
              <p className="text-xs text-muted-foreground">{activeTask?.description}</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cn-profile">模型档案</Label>
              <Select value={profileId} onValueChange={setProfileId}>
                <SelectTrigger id="cn-profile">
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

          {(needsPlan || showOutlineCount) && (
            <div className="grid gap-4 md:grid-cols-2">
              {needsPlan && (
                <div className="space-y-1.5">
                  <Label htmlFor="cn-plan">目标方向</Label>
                  <Select
                    value={targetPlan?.id ?? ""}
                    onValueChange={(v) => setExpandedId(v)}
                    disabled={plans.length === 0}
                  >
                    <SelectTrigger id="cn-plan">
                      <SelectValue placeholder="尚无方向" />
                    </SelectTrigger>
                    <SelectContent>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {PLAN_STATUS_LABEL[p.status]} · {p.direction.slice(0, 24)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {showOutlineCount
                      ? targetPlan?.draftCount
                        ? "该方向已有草稿，需先导出并删除现有草稿，才能重新生成章纲。"
                        : `章纲会覆盖写入该方向，并把它的版本号 +1${
                            targetPlan && targetPlan.outline.length > 0
                              ? `（当前已有 ${targetPlan.outline.length} 章，将被覆盖）`
                              : ""
                          }`
                      : isContinuityTask
                        ? "逐章核对这个方向的草稿，产出「待核对」的问题；重新检查会替换上一次的结果。"
                        : isDraftMemoryTask
                          ? "逐章对照记忆，提取草稿带来的新事件、人物变化与悬念进展，产出待确认的记忆提案。"
                          : "只生成还没有草稿的章；已有草稿的章请到下方草稿列表里单独重新生成。"}
                  </p>
                </div>
              )}

              {showOutlineCount && (
                <div className="space-y-1.5">
                  <Label htmlFor="cn-count">规划章数</Label>
                  <Select
                    value={String(outlineCount)}
                    onValueChange={(v) => setOutlineCount(Number(v))}
                  >
                    <SelectTrigger id="cn-count">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OUTLINE_COUNT_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          接下来 {n} 章
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          {blocked && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{blocked}（仍可启动，服务端会再次校验）。</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              onClick={() => void start()}
              disabled={
                busy ||
                runActive ||
                profiles.length === 0 ||
                (showOutlineCount && Boolean(targetPlan?.draftCount))
              }
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              开始{activeTask?.label ?? "续写任务"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 运行状态（常驻） */}
      <RunStatusPanel
        taskLabel={activeTask?.label ?? "续写任务"}
        run={displayRun}
        producedLabel={PRODUCED_LABEL[taskType] ?? "项"}
        idleHint={
          blocked
            ? `这个步骤还没有运行过。${blocked}。`
            : "这个步骤还没有运行过，配置好后点上面的「开始」。"
        }
        actions={runActions}
      />

      {/* 方向与章纲（常驻：方向选择始终可达） */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Compass className="size-4 text-muted-foreground" aria-hidden />
              <span className="font-medium">续写方向</span>
              <span className="text-sm text-muted-foreground">共 {plans.length} 个</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refreshPlans()}>
              <RotateCcw className="size-4" />
              刷新
            </Button>
          </div>

          {plans.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center">
              <p className="text-sm text-muted-foreground">
                还没有续写方向。先运行「逐章抽取」积累记忆，再生成 2–3 个差异明显的方向。
              </p>
            </div>
          ) : (
            <ul role="list" className="space-y-3">
              {plans.map((plan) => {
                const isExpanded = targetPlan?.id === plan.id;
                const isEditing = editing?.planId === plan.id;
                return (
                  <li key={plan.id} className="rounded-lg border bg-card">
                    <div className="space-y-2 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={toneClass(PLAN_STATUS_TONE[plan.status])}
                        >
                          {PLAN_STATUS_LABEL[plan.status]}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          v{plan.version}
                        </Badge>
                        <Badge variant="outline" className="text-xs font-normal">
                          章纲 {plan.outline.length} 章
                        </Badge>
                        {plan.draftCount > 0 && (
                          <Badge variant="outline" className="text-xs font-normal">
                            草稿 {plan.draftCount} 章
                          </Badge>
                        )}
                      </div>

                      <p className="font-medium">{plan.direction}</p>
                      {plan.summary && (
                        <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                          {plan.summary}
                        </p>
                      )}

                      {plan.relatedThreads.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {plan.relatedThreads.map((t, i) => (
                            <Badge key={i} variant="outline" className="text-xs font-normal">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(isExpanded ? null : plan.id)}
                        >
                          {isExpanded ? "收起章纲" : "查看章纲"}
                        </Button>
                        {plan.status !== "active" && (
                          <Button
                            size="sm"
                            onClick={() => void activate(plan.id)}
                            disabled={actingPlan === plan.id}
                          >
                            {actingPlan === plan.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Check className="size-4" />
                            )}
                            选定此方向
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(plan)}
                          disabled={actingPlan === plan.id}
                        >
                          <Trash2 className="size-4" />
                          删除
                        </Button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="space-y-3 border-t bg-muted/20 p-4">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">章纲</span>
                          {!isEditing && (
                            <Button variant="outline" size="sm" onClick={() => beginEdit(plan)}>
                              <Pencil className="size-4" />
                              编辑章纲
                            </Button>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="space-y-3">
                            {editing.items.map((item, i) => (
                              <div key={i} className="space-y-2 rounded-md border bg-card p-3">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-muted-foreground">
                                    第 {i + 1} 章
                                  </span>
                                  <Input
                                    value={item.title}
                                    onChange={(e) => updateItem(i, { title: e.target.value })}
                                    placeholder="章标题"
                                    aria-label={`第 ${i + 1} 章标题`}
                                    className="flex-1"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => removeItem(i)}
                                    aria-label={`删除第 ${i + 1} 章`}
                                  >
                                    <X className="size-4" />
                                  </Button>
                                </div>
                                <Textarea
                                  value={item.summary}
                                  onChange={(e) => updateItem(i, { summary: e.target.value })}
                                  placeholder="本章走向"
                                  aria-label={`第 ${i + 1} 章走向`}
                                  rows={2}
                                />
                                <Textarea
                                  value={item.beats.join("\n")}
                                  onChange={(e) =>
                                    updateItem(i, {
                                      beats: e.target.value
                                        .split("\n")
                                        .map((b) => b.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  placeholder="关键节拍，一行一条"
                                  aria-label={`第 ${i + 1} 章节拍`}
                                  rows={3}
                                />
                              </div>
                            ))}

                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Button variant="outline" size="sm" onClick={addItem}>
                                <Plus className="size-4" />
                                添加一章
                              </Button>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditing(null)}
                                  disabled={saving}
                                >
                                  取消
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => void saveOutline()}
                                  disabled={saving}
                                >
                                  {saving ? (
                                    <Loader2 className="size-4 animate-spin" />
                                  ) : (
                                    <Save className="size-4" />
                                  )}
                                  保存章纲
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : plan.outline.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            这个方向还没有章纲。选中「生成章纲」步骤即可为它排序接下来的章节。
                          </p>
                        ) : (
                          <ol className="space-y-2">
                            {plan.outline.map((item) => (
                              <li key={item.index} className="rounded-md border bg-card p-3">
                                <p className="text-sm font-medium">
                                  第 {item.index} 章 · {item.title}
                                </p>
                                {item.summary && (
                                  <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                                    {item.summary}
                                  </p>
                                )}
                                {item.beats.length > 0 && (
                                  <ul className="mt-2 space-y-0.5">
                                    {item.beats.map((b, i) => (
                                      <li
                                        key={i}
                                        className="text-xs text-muted-foreground before:mr-1.5 before:content-['·']"
                                      >
                                        {b}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {item.relatedThreads.length > 0 && (
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    {item.relatedThreads.map((t, i) => (
                                      <Badge
                                        key={i}
                                        variant="outline"
                                        className="text-xs font-normal"
                                      >
                                        {t}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 草稿：仅草稿类步骤展开 */}
      {showDrafts && (
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-medium">续写草稿</span>
                <span className="text-sm text-muted-foreground">
                  {targetPlan
                    ? `方向「${targetPlan.direction.slice(0, 24)}」共 ${drafts.length} 章`
                    : "尚未选定方向"}
                </span>
              </div>
              {targetPlanId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadKey((k) => k + 1)}
                >
                  <RotateCcw className="size-4" />
                  刷新
                </Button>
              )}
            </div>

            {!targetPlan ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  先到上方生成并选定一个续写方向。
                </p>
              </div>
            ) : drafts.length === 0 ? (
              <div className="rounded-lg border border-dashed p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {targetPlan.outline.length === 0
                    ? "这个方向还没有章纲，请先运行「生成章纲」。"
                    : `章纲已有 ${targetPlan.outline.length} 章，选中「生成草稿」步骤即可逐章写出正文。`}
                </p>
              </div>
            ) : (
              <ul role="list" className="space-y-2">
                {drafts.map((d) => (
                  <li key={d.id} className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            第 {d.index} 章 · {d.title || "（无标题）"}
                          </span>
                          <Badge variant="secondary" className="text-xs">
                            v{d.version}
                          </Badge>
                          <Badge variant="outline" className="text-xs font-normal">
                            {d.content.length} 字
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-xs font-normal",
                              toneClass(MEMORY_UPDATE_TONE[d.memoryUpdateStatus]),
                            )}
                          >
                            {MEMORY_UPDATE_LABEL[d.memoryUpdateStatus]}
                          </Badge>
                          {openIssueCounts.get(d.id) ? (
                            <Badge variant="outline" className={toneClass("warning")}>
                              {openIssueCounts.get(d.id)} 处待核对
                            </Badge>
                          ) : null}
                        </div>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {d.content.slice(0, 120)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void checkContinuity(d)}
                          disabled={busy || runActive}
                        >
                          <ScanSearch className="size-4" />
                          检查连续性
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void proposeMemory(d)}
                          disabled={busy || runActive}
                        >
                          <Sparkles className="size-4" />
                          提取记忆变化
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingDraftId(d.id)}
                        >
                          <Pencil className="size-4" />
                          阅读 / 编辑
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这个续写方向？</AlertDialogTitle>
            <AlertDialogDescription>
              「{pendingDelete?.direction}」及其章纲、草稿都会被删除，无法撤销。原文与记忆不受影响。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && void removePlan(pendingDelete)}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {editingDraft && (
        <DraftEditor
          key={`${editingDraft.id}-${editingDraft.version}`}
          draft={editingDraft}
          open
          regenerating={runActive}
          issues={editingDraftIssues}
          checking={runActive}
          proposing={runActive}
          onOpenChange={(o) => !o && setEditingDraftId(null)}
          onSaved={(saved) =>
            setDrafts((prev) => prev.map((d) => (d.id === saved.id ? saved : d)))
          }
          onDeleted={(id) => {
            setDrafts((prev) => prev.filter((d) => d.id !== id));
            setEditingDraftId(null);
          }}
          onRegenerate={() => void regenerateDraft(editingDraft)}
          onCheck={() => void checkContinuity(editingDraft)}
          onProposeMemory={() => void proposeMemory(editingDraft)}
          onIssueStatus={(issueId, status) => void setIssueStatus(issueId, status)}
        />
      )}

      <CloudAuthorizeDialog
        open={authOpen}
        preview={preview}
        authorizing={authorizing}
        onOpenChange={setAuthOpen}
        onConfirm={() => void confirmAuthorize()}
      />
    </div>
  );
}
